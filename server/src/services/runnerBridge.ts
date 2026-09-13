import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { TestCase, TestCaseEvaluation } from './cRunner';
import {
  recordBenchmarkEvent,
  claimNextQueuedJob,
  saveJobResult,
  broadcastStateUpdate,
  BenchmarkJob,
} from './benchmarkService';
import prisma from '../utils/prisma';

export interface EvaluationResultPayload {
  allPassed: boolean;
  compileError: string | null;
  securityViolation: string | null;
  results: TestCaseEvaluation[];
}

export interface RunnerWorkerInfo {
  id: string;
  name: string;
  socket: Socket;
  activeJobs: number;
  completedJobs: number;
  maxConcurrency: number;
  connectedAt: number;
}

interface PendingJob {
  jobId: string;
  workerId: string;
  resolve: (result: EvaluationResultPayload) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const workers = new Map<string, RunnerWorkerInfo>();
const pendingJobs = new Map<string, PendingJob>();

const RUNNER_SECRET = process.env.RUNNER_TOKEN || 'sasi-runner-secret-key-2026';

let runnerNamespace: ReturnType<Server['of']> | null = null;

/**
 * Initialize the Socket.IO /runner namespace for external workers.
 */
export function initRunnerBridge(io: Server): void {
  runnerNamespace = io.of('/runner');

  runnerNamespace.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.headers['x-runner-token'] as string | undefined);

    if (token && token === RUNNER_SECRET) {
      return next();
    }
    console.warn(`[Runner Bridge] Unauthorized connection attempt from ${socket.handshake.address}`);
    return next(new Error('Unauthorized: Invalid runner token.'));
  });

  runnerNamespace.on('connection', (socket: Socket) => {
    const workerId = socket.id;
    const workerName = (socket.handshake.auth?.name as string) || `Worker-${workerId.slice(0, 6)}`;
    const concurrency = Number(socket.handshake.auth?.concurrency) || 8;

    const workerInfo: RunnerWorkerInfo = {
      id: workerId,
      name: workerName,
      socket,
      activeJobs: 0,
      completedJobs: 0,
      maxConcurrency: Math.max(1, Math.min(concurrency, 32)),
      connectedAt: Date.now(),
    };

    workers.set(workerId, workerInfo);
    console.log(
      `[Runner Bridge] External worker registered: "${workerName}" (id: ${workerId}, concurrency: ${workerInfo.maxConcurrency})`
    );

    // Explicit registration handshake
    socket.on('RUNNER_REGISTER', (data: { runnerId?: string; capacity?: number }) => {
      const w = workers.get(workerId);
      if (w) {
        if (data.runnerId) w.name = data.runnerId;
        if (data.capacity) w.maxConcurrency = data.capacity;
        socket.emit('RUNNER_REGISTERED', {
          success: true,
          runnerId: w.name,
          capacity: w.maxConcurrency,
          timestamp: new Date().toISOString(),
        });
        console.log(`[Runner Bridge] Handshake ACK sent to "${w.name}" (Capacity: ${w.maxConcurrency})`);
      }
    });

    // ── Standard Evaluation Handler (for students) ──
    socket.on('JOB_RESULT', (data: { jobId: string; error?: string; result?: EvaluationResultPayload }) => {
      const pending = pendingJobs.get(data.jobId);
      if (!pending) return;

      clearTimeout(pending.timer);
      pendingJobs.delete(data.jobId);

      const worker = workers.get(workerId);
      if (worker) {
        worker.activeJobs = Math.max(0, worker.activeJobs - 1);
        worker.completedJobs++;
      }

      if (data.error || !data.result) {
        pending.reject(new Error(data.error || 'Runner returned empty result'));
      } else {
        pending.resolve(data.result);
      }
    });

    // ── Benchmark Real-Time Stage Transition Handler ──
    socket.on(
      'BENCHMARK_STAGE_UPDATE',
      async (data: {
        jobId: string;
        runId: string;
        workerId: string;
        testUserId: string;
        stage: string;
        elapsedMs: number;
      }) => {
        const eventType = data.stage;

        await recordBenchmarkEvent(data.runId, data.jobId, eventType, data.workerId, data.testUserId, {
          stage: data.stage,
          elapsedMs: data.elapsedMs,
        });

        if (data.stage === 'COMPILING' || data.stage === 'EXECUTING' || data.stage === 'WORKER_JOB_ASSIGNED') {
          await prisma.$executeRawUnsafe(
            `UPDATE runner_benchmark_jobs SET status = $1 WHERE id = $2 AND status NOT IN ('PASSED', 'FAILED', 'COMPILE_ERROR', 'RUNTIME_ERROR', 'TIMEOUT');`,
            data.stage === 'WORKER_JOB_ASSIGNED' ? 'ASSIGNED' : data.stage,
            data.jobId
          ).catch(() => {});
        }

        broadcastStateUpdate();
      }
    );

    // ── Benchmark Job Completion & Next Job Claim Handler ──
    socket.on(
      'BENCHMARK_JOB_RESULT',
      async (data: {
        jobId: string;
        runId: string;
        workerId: string;
        testUserId: string;
        status: 'PASSED' | 'FAILED' | 'COMPILE_ERROR' | 'RUNTIME_ERROR' | 'TIMEOUT';
        stdout: string;
        stderr: string;
        exitCode: number;
        compileTimeMs: number;
        executionTimeMs: number;
        totalTimeMs: number;
        errorMessage?: string;
      }) => {
        const worker = workers.get(workerId);
        if (worker) {
          worker.activeJobs = Math.max(0, worker.activeJobs - 1);
          worker.completedJobs++;
        }

        // 1. Atomically update job result in Supabase
        await saveJobResult(data.jobId, data);

        // 2. Transactionally claim NEXT queued job for this worker slot
        const nextJob = await claimNextQueuedJob(data.runId, data.workerId);
        if (nextJob) {
          if (worker) worker.activeJobs++;
          socket.emit('BENCHMARK_EXECUTE_JOB', {
            jobId: nextJob.id,
            runId: nextJob.runId,
            testUserId: nextJob.testUserId,
            workerId: data.workerId,
            sourceCode: nextJob.sourceCode,
            input: nextJob.input,
            expectedOutput: nextJob.expectedOutput,
            timeoutMs: 2000,
          });
        } else {
          // Check if all jobs in the run are finished
          const pendingRemaining = await prisma.$queryRawUnsafe<any[]>(
            `SELECT count(*)::int as count FROM runner_benchmark_jobs WHERE "runId" = $1 AND status IN ('QUEUED', 'ASSIGNED', 'COMPILING', 'EXECUTING');`,
            data.runId
          );
          if (pendingRemaining && pendingRemaining[0]?.count === 0) {
            await prisma.$executeRawUnsafe(
              `UPDATE runner_benchmark_runs SET status = 'COMPLETED', "completedAt" = NOW(), "totalWallTimeMs" = ROUND(EXTRACT(EPOCH FROM (NOW() - "startedAt")) * 1000) WHERE id = $1;`,
              data.runId
            );
            await recordBenchmarkEvent(data.runId, null, 'RUN_COMPLETED', null, null, {
              status: 'COMPLETED',
            });
            broadcastStateUpdate();
          }
        }
      }
    );

    socket.on('disconnect', (reason) => {
      console.warn(`[Runner Bridge] Worker disconnected: "${workerName}" (${reason})`);
      workers.delete(workerId);

      for (const [jobId, job] of pendingJobs.entries()) {
        if (job.workerId === workerId) {
          clearTimeout(job.timer);
          pendingJobs.delete(jobId);
          job.reject(new Error(`Worker ${workerName} disconnected during job execution`));
        }
      }
    });
  });
}

/**
 * Check if at least one external runner worker is connected and has capacity.
 */
export function isRunnerAvailable(): boolean {
  if (workers.size === 0) return false;
  for (const worker of workers.values()) {
    if (worker.activeJobs < worker.maxConcurrency) {
      return true;
    }
  }
  return false;
}

/**
 * Dispatch an execution job to the least-busy connected external runner.
 */
export async function executeRemoteJob(
  sourceCode: string,
  testCases: TestCase[],
  type: 'SAMPLE' | 'HIDDEN',
  timeoutMs: number
): Promise<EvaluationResultPayload> {
  let bestWorker: RunnerWorkerInfo | null = null;
  for (const worker of workers.values()) {
    if (worker.activeJobs < worker.maxConcurrency) {
      if (!bestWorker || worker.activeJobs < bestWorker.activeJobs) {
        bestWorker = worker;
      }
    }
  }

  if (!bestWorker) {
    throw new Error('No external runner workers currently have available capacity');
  }

  const jobId = randomUUID();
  const worker = bestWorker;
  worker.activeJobs++;

  return new Promise<EvaluationResultPayload>((resolve, reject) => {
    const maxWaitMs = timeoutMs * (testCases.length || 1) + 8000;

    const timer = setTimeout(() => {
      pendingJobs.delete(jobId);
      worker.activeJobs = Math.max(0, worker.activeJobs - 1);
      reject(new Error(`Remote execution timed out after ${maxWaitMs}ms`));
    }, maxWaitMs);

    pendingJobs.set(jobId, {
      jobId,
      workerId: worker.id,
      resolve,
      reject,
      timer,
    });

    worker.socket.emit('EXECUTE_JOB', {
      jobId,
      sourceCode,
      testCases,
      type,
      timeoutMs,
    });
  });
}

/**
 * Dispatch a benchmark job to a specific runner and worker slot
 */
export function dispatchBenchmarkJobToAvailableRunner(
  job: BenchmarkJob,
  runnerSocketId: string,
  workerSlot: string
): boolean {
  const runner = workers.get(runnerSocketId);
  if (!runner) return false;

  runner.activeJobs++;
  runner.socket.emit('BENCHMARK_EXECUTE_JOB', {
    jobId: job.id,
    runId: job.runId,
    testUserId: job.testUserId,
    workerId: workerSlot,
    sourceCode: job.sourceCode,
    input: job.input,
    expectedOutput: job.expectedOutput,
    timeoutMs: 2000,
  });

  return true;
}

/**
 * Get connected runners list
 */
export function getConnectedRunnersList() {
  return Array.from(workers.values()).map((w) => ({
    id: w.id,
    name: w.name,
    activeJobs: w.activeJobs,
    completedJobs: w.completedJobs,
    maxConcurrency: w.maxConcurrency,
    connectedAt: w.connectedAt,
  }));
}

/**
 * Retrieve stats for monitoring & health check endpoints.
 */
export function getRunnerStats() {
  const workerList = getConnectedRunnersList();
  return {
    connectedWorkers: workers.size,
    activeJobs: pendingJobs.size,
    workers: workerList,
  };
}
