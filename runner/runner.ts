/**
 * SASI Engineers' Day - Standalone External C Code Execution Worker
 * Enhanced with Strict 8-Worker Pool Architecture, Live Real-Time GUI (Terminal + Port 3005),
 * and Real Supabase PostgreSQL Integration Protocol.
 */

import { io, Socket } from 'socket.io-client';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import http from 'http';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const RUNNER_TOKEN = process.env.RUNNER_TOKEN || 'sasi-runner-secret-key-2026';
const WORKER_NAME = process.env.WORKER_NAME || `Local-Runner-Linux-8W`;
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY || '8', 10));
const GUI_PORT = Number(process.env.GUI_PORT) || 3005;

interface TestCase {
  input: string;
  expectedOutput: string;
}

interface TestCaseEvaluation {
  name: string;
  type: 'SAMPLE' | 'HIDDEN';
  status: 'PASSED' | 'FAILED' | 'TIME_LIMIT_EXCEEDED' | 'OUTPUT_LIMIT_EXCEEDED' | 'RUNTIME_ERROR' | 'SECURITY_VIOLATION';
  timeMs: number;
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  error?: string;
}

interface JobPayload {
  jobId: string;
  sourceCode: string;
  testCases: TestCase[];
  type: 'SAMPLE' | 'HIDDEN';
  timeoutMs: number;
}

interface BenchmarkJobPayload {
  jobId: string;
  runId: string;
  testUserId: string;
  workerId: string;
  sourceCode: string;
  input: string;
  expectedOutput: string;
  timeoutMs: number;
}

// ── Strict Worker Pool Model ─────────────────────────────────────────────────
export interface WorkerSlot {
  id: number;
  name: string;
  slotKey: string;
  status: 'WORKER_IDLE' | 'WORKER_JOB_ASSIGNED' | 'COMPILING' | 'COMPILED' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  activeJob: {
    jobId: string;
    runId: string;
    testUserId: string;
    stage: string;
    startTime: number;
    compileTimeMs: number;
    executionTimeMs: number;
    elapsedMs: number;
    cpu: number;
  } | null;
  completedJobsCount: number;
  failedJobsCount: number;
}

// Exactly CONCURRENCY workers maintained in memory
const workers: WorkerSlot[] = Array.from({ length: CONCURRENCY }, (_, i) => ({
  id: i + 1,
  name: `Worker ${i + 1}`,
  slotKey: `worker-${i + 1}`,
  status: 'WORKER_IDLE',
  activeJob: null,
  completedJobsCount: 0,
  failedJobsCount: 0,
}));

let totalCompleted = 0;
let totalFailed = 0;
let currentRunId = 'AWAITING_BENCHMARK';
let totalRunJobs = 120;
let queuedJobsMetadata: Array<{ id: string; testUserId: string }> = [];
let isConnected = false;
let socketId = '';

const DANGEROUS_PATTERNS = [
  /#include\s*<sys\/.*>/i,
  /#include\s*<windows\.h>/i,
  /#include\s*<unistd\.h>/i,
  /#include\s*<process\.h>/i,
  /#include\s*<fstream>/i,
  /#include\s*<dirent\.h>/i,
  /#include\s*<signal\.h>/i,
  /#include\s*<pthread\.h>/i,
  /#include\s*<arpa\/.*>/i,
  /#include\s*<netinet\/.*>/i,
  /#include\s*<netdb\.h>/i,
  /#include\s*<linux\/.*>/i,
  /#include\s*<fcntl\.h>/i,
  /#include\s*<dlfcn\.h>/i,
  /\bsystem\s*\(/i,
  /\bfork\s*\(/i,
  /\bvfork\s*\(/i,
  /\bclone\s*\(/i,
  /\bexec[lvpe]*\s*\(/i,
  /\bpopen\s*\(/i,
  /\bkill\s*\(/i,
  /\bptrace\s*\(/i,
  /\bsetuid\s*\(/i,
  /\bsetgid\s*\(/i,
  /\bchmod\s*\(/i,
  /\bchown\s*\(/i,
  /\bfopen\s*\(/i,
  /\bfreopen\s*\(/i,
  /\bopen\s*\(/i,
  /\bopenat\s*\(/i,
  /\bcreat\s*\(/i,
  /\bremove\s*\(/i,
  /\brename\s*\(/i,
  /\bunlink\s*\(/i,
  /\bmkdir\s*\(/i,
  /\brmdir\s*\(/i,
  /\btruncate\s*\(/i,
  /\b__asm__\b/i,
  /\basm\b/i,
  /\bsyscall\s*\(/i,
];

function normalizeOutput(s: string): string {
  if (!s) return '';
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

// ── System Metrics Reader ───────────────────────────────────────────────────
function getSystemTelemetry() {
  let cpuPercent = 0;
  let usedGb = 0;
  let pkgTemp = 0;

  try {
    const mem = require('fs').readFileSync('/proc/meminfo', 'utf8');
    const totalMatch = mem.match(/MemTotal:\s+(\d+)\s+kB/);
    const availMatch = mem.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (totalMatch && availMatch) {
      usedGb = parseFloat(((parseInt(totalMatch[1], 10) - parseInt(availMatch[1], 10)) / 1048576).toFixed(2));
    }
  } catch {}

  try {
    pkgTemp = parseInt(require('fs').readFileSync('/sys/class/thermal/thermal_zone6/temp', 'utf8').trim(), 10) / 1000;
  } catch {}

  return { cpuPercent, usedGb, pkgTemp };
}

// ── Compilation ─────────────────────────────────────────────────────────────
async function compileC(sourceCode: string) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sourceCode)) {
      return {
        binPath: null,
        cleanup: async () => {},
        securityViolation: 'Security Violation: Restricted system call or header detected.',
        compileError: null,
      };
    }
  }

  const id = randomUUID();
  const tempDir = path.join(tmpdir(), 'sasi-runner-sandbox');
  await fs.mkdir(tempDir, { recursive: true }).catch(() => {});

  const isWindows = process.platform === 'win32';
  const binExt = isWindows ? '.exe' : '.out';
  const srcPath = path.join(tempDir, `source_${id}.c`);
  const binPath = path.join(tempDir, `exec_${id}${binExt}`);

  const cleanup = async () => {
    await Promise.all([
      fs.unlink(srcPath).catch(() => {}),
      fs.unlink(binPath).catch(() => {}),
    ]);
  };

  try {
    await fs.writeFile(srcPath, sourceCode, 'utf-8');
  } catch (err: any) {
    await cleanup();
    return {
      binPath: null,
      cleanup: async () => {},
      securityViolation: null,
      compileError: `Failed to write temporary source file: ${err.message}`,
    };
  }

  // Compile using GCC with -O2, -std=c11, -pipe as specified
  const compileResult = await new Promise<{ error: Error | null; stderr: string; stdout: string }>((res) => {
    const compileCmd = `gcc "${srcPath}" -o "${binPath}" -O2 -std=c11 -pipe -lm -w`;
    exec(compileCmd, { cwd: tempDir, timeout: 5000, maxBuffer: 32 * 1024 }, (err, stdout, stderr) => {
      res({ error: err, stderr, stdout });
    });
  });

  if (compileResult.error) {
    await cleanup();
    return {
      binPath: null,
      cleanup: async () => {},
      securityViolation: null,
      compileError: compileResult.stderr || compileResult.error.message || 'Compilation failed',
    };
  }

  return { binPath, cleanup, securityViolation: null, compileError: null };
}

const HAS_PRLIMIT = process.platform === 'linux';

// ── Binary Sandbox Execution ────────────────────────────────────────────────
function runBinary(binPath: string, inputData: string, timeoutMs: number) {
  const startTime = performance.now();
  const safeInput = typeof inputData === 'string' ? inputData.slice(0, 16 * 1024) : '';

  return new Promise<{
    output: string;
    error: string | null;
    timeMs: number;
    exitCode: number;
    success: boolean;
  }>((resolve) => {
    let cmd: string;
    if (HAS_PRLIMIT) {
      cmd = `/usr/bin/prlimit --as=134217728 --cpu=2 --nproc=10 --fsize=65536 "${binPath}"`;
    } else {
      cmd = `"${binPath}"`;
    }

    const child = exec(
      cmd,
      {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
      },
      (err, stdout, stderr) => {
        const timeMs = Math.round(performance.now() - startTime);

        if (err) {
          if (err.killed || (err as any).signal === 'SIGTERM') {
            return resolve({ output: '', error: 'TIME_LIMIT_EXCEEDED', timeMs, exitCode: 124, success: false });
          }
          if (stderr && stderr.includes('maxBuffer')) {
            return resolve({ output: '', error: 'OUTPUT_LIMIT_EXCEEDED', timeMs, exitCode: 1, success: false });
          }
          return resolve({
            output: stdout || '',
            error: stderr || err.message || 'RUNTIME_ERROR',
            timeMs,
            exitCode: (err as any).code || 1,
            success: false,
          });
        }

        resolve({
          output: stdout || '',
          error: null,
          timeMs,
          exitCode: 0,
          success: true,
        });
      }
    );

    if (child.stdin) {
      try {
        if (safeInput) {
          child.stdin.write(safeInput);
        }
        child.stdin.end();
      } catch {}
    }
  });
}

// ── Socket Connection to Central Backend ────────────────────────────────────
console.log(`[Connecting] Outbound WebSocket to ${SERVER_URL}/runner ...`);

const socket: Socket = io(`${SERVER_URL}/runner`, {
  auth: { token: RUNNER_TOKEN },
  extraHeaders: { 'x-runner-token': RUNNER_TOKEN },
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

socket.on('connect', () => {
  isConnected = true;
  socketId = socket.id || '';
  console.log(`\n[✓] Connected to Central Backend as worker "${WORKER_NAME}" (Socket ID: ${socketId})`);

  socket.emit('RUNNER_REGISTER', {
    workerName: WORKER_NAME,
    maxConcurrency: CONCURRENCY,
    platform: process.platform,
    arch: process.arch,
    hasPrlimit: HAS_PRLIMIT,
    timestamp: Date.now(),
  });
});

socket.on('RUNNER_REGISTERED', (data: any) => {
  console.log(`[✓] Handshake Confirmed by Backend: capacity=${data.capacity} workers`);
});

socket.on('disconnect', (reason) => {
  isConnected = false;
  console.warn(`[!] Disconnected from server: ${reason}. Attempting reconnect...`);
});

socket.on('connect_error', (err) => {
  console.error(`[X] Connection error: ${err.message}`);
});

// Update queue metadata from live server broadcasts
socket.on('runner_benchmark:status', (state: any) => {
  if (!state) return;
  if (state.run) {
    currentRunId = state.run.id;
    totalRunJobs = state.run.totalJobs || 120;
  }
  if (state.queuedMetadata) {
    queuedJobsMetadata = state.queuedMetadata;
  }
});

// ── STRICT WORKER POOL EXECUTION HANDLER ────────────────────────────────────
socket.on('BENCHMARK_EXECUTE_JOB', async (payload: BenchmarkJobPayload) => {
  const { jobId, runId, testUserId, workerId, sourceCode, input, expectedOutput, timeoutMs } = payload;
  currentRunId = runId;

  // Locate the target worker slot
  let worker = workers.find((w) => w.slotKey === workerId);
  if (!worker) {
    worker = workers.find((w) => w.status === 'WORKER_IDLE');
  }
  if (!worker) {
    worker = workers[0];
  }

  // Assign job to worker
  worker.status = 'WORKER_JOB_ASSIGNED';
  worker.activeJob = {
    jobId,
    runId,
    testUserId,
    stage: 'WORKER_JOB_ASSIGNED',
    startTime: Date.now(),
    compileTimeMs: 0,
    executionTimeMs: 0,
    elapsedMs: 0,
    cpu: 100,
  };

  // 1. Stage: WORKER_JOB_ASSIGNED
  socket.emit('BENCHMARK_STAGE_UPDATE', {
    jobId,
    runId,
    workerId: worker.slotKey,
    testUserId,
    stage: 'WORKER_JOB_ASSIGNED',
    elapsedMs: 0,
  });

  // 2. Stage: COMPILING
  worker.status = 'COMPILING';
  worker.activeJob.stage = 'COMPILING';
  socket.emit('BENCHMARK_STAGE_UPDATE', {
    jobId,
    runId,
    workerId: worker.slotKey,
    testUserId,
    stage: 'COMPILING',
    elapsedMs: 0,
  });

  const compileStart = performance.now();
  const { binPath, cleanup, securityViolation, compileError } = await compileC(sourceCode);
  const compileDuration = Math.round(performance.now() - compileStart);
  worker.activeJob.compileTimeMs = compileDuration;

  if (securityViolation) {
    worker.status = 'FAILED';
    worker.failedJobsCount++;
    totalFailed++;
    socket.emit('BENCHMARK_STAGE_UPDATE', {
      jobId,
      runId,
      workerId: worker.slotKey,
      testUserId,
      stage: 'FAILED',
      elapsedMs: compileDuration,
    });
    socket.emit('BENCHMARK_JOB_RESULT', {
      jobId,
      runId,
      workerId: worker.slotKey,
      testUserId,
      status: 'RUNTIME_ERROR',
      stdout: '',
      stderr: securityViolation,
      exitCode: 1,
      compileTimeMs: compileDuration,
      executionTimeMs: 0,
      totalTimeMs: compileDuration,
      errorMessage: securityViolation,
    });
    worker.status = 'WORKER_IDLE';
    worker.activeJob = null;
    socket.emit('BENCHMARK_STAGE_UPDATE', {
      jobId: null,
      runId,
      workerId: worker.slotKey,
      testUserId: null,
      stage: 'WORKER_IDLE',
      elapsedMs: 0,
    });
    return;
  }

  if (compileError || !binPath) {
    worker.status = 'FAILED';
    worker.failedJobsCount++;
    totalFailed++;
    socket.emit('BENCHMARK_STAGE_UPDATE', {
      jobId,
      runId,
      workerId: worker.slotKey,
      testUserId,
      stage: 'FAILED',
      elapsedMs: compileDuration,
    });
    socket.emit('BENCHMARK_JOB_RESULT', {
      jobId,
      runId,
      workerId: worker.slotKey,
      testUserId,
      status: 'COMPILE_ERROR',
      stdout: '',
      stderr: compileError || 'Compilation failed',
      exitCode: 1,
      compileTimeMs: compileDuration,
      executionTimeMs: 0,
      totalTimeMs: compileDuration,
      errorMessage: compileError || 'Compilation failed',
    });
    worker.status = 'WORKER_IDLE';
    worker.activeJob = null;
    socket.emit('BENCHMARK_STAGE_UPDATE', {
      jobId,
      runId,
      workerId: worker.slotKey,
      testUserId,
      stage: 'WORKER_IDLE',
      elapsedMs: 0,
    });
    return;
  }

  // 3. Stage: COMPILED
  worker.status = 'COMPILED';
  worker.activeJob.stage = 'COMPILED';
  socket.emit('BENCHMARK_STAGE_UPDATE', {
    jobId,
    runId,
    workerId: worker.slotKey,
    testUserId,
    stage: 'COMPILED',
    elapsedMs: compileDuration,
  });

  // 4. Stage: EXECUTING
  worker.status = 'EXECUTING';
  worker.activeJob.stage = 'EXECUTING';
  socket.emit('BENCHMARK_STAGE_UPDATE', {
    jobId,
    runId,
    workerId: worker.slotKey,
    testUserId,
    stage: 'EXECUTING',
    elapsedMs: compileDuration,
  });

  let execResult: any;
  try {
    execResult = await runBinary(binPath, input || '', timeoutMs || 2000);
  } finally {
    // Crucial: Clean up binary and source file immediately after execution!
    await cleanup();
  }

  const executionDuration = execResult.timeMs || 0;
  worker.activeJob.executionTimeMs = executionDuration;

  const actualOutput = normalizeOutput(execResult.output);
  const expected = normalizeOutput(expectedOutput);
  const isMatch = execResult.success && (expected === '' || actualOutput === expected);

  let status: 'PASSED' | 'FAILED' | 'COMPILE_ERROR' | 'RUNTIME_ERROR' | 'TIMEOUT' = 'PASSED';
  if (execResult.error === 'TIME_LIMIT_EXCEEDED') {
    status = 'TIMEOUT';
  } else if (execResult.error === 'RUNTIME_ERROR' || execResult.error === 'OUTPUT_LIMIT_EXCEEDED') {
    status = 'RUNTIME_ERROR';
  } else if (!isMatch) {
    status = 'FAILED';
  }

  if (status === 'PASSED') {
    worker.status = 'COMPLETED';
    worker.completedJobsCount++;
    totalCompleted++;
  } else {
    worker.status = 'FAILED';
    worker.failedJobsCount++;
    totalFailed++;
  }

  // 5. Stage: COMPLETED or FAILED
  socket.emit('BENCHMARK_STAGE_UPDATE', {
    jobId,
    runId,
    workerId: worker.slotKey,
    testUserId,
    stage: worker.status,
    elapsedMs: executionDuration,
  });

  // 6. Emit Result to Server (which saves to Supabase and claims next job)
  socket.emit('BENCHMARK_JOB_RESULT', {
    jobId,
    runId,
    workerId: worker.slotKey,
    testUserId,
    status,
    stdout: execResult.output || '',
    stderr: execResult.error || '',
    exitCode: execResult.exitCode,
    compileTimeMs: compileDuration,
    executionTimeMs: executionDuration,
    totalTimeMs: compileDuration + executionDuration,
    errorMessage: isMatch ? null : `Output Mismatch: Expected "${expected}", Got "${actualOutput}"`,
  });

  // 7. Reset worker to WORKER_IDLE
  worker.status = 'WORKER_IDLE';
  worker.activeJob = null;
  socket.emit('BENCHMARK_STAGE_UPDATE', {
    jobId: null,
    runId,
    workerId: worker.slotKey,
    testUserId: null,
    stage: 'WORKER_IDLE',
    elapsedMs: 0,
  });
});

// ── Standard Student Execution Handler ───────────────────────────────────────
socket.on('EXECUTE_JOB', async (job: JobPayload) => {
  const { jobId, sourceCode, testCases, type, timeoutMs } = job;

  try {
    const { binPath, cleanup, securityViolation, compileError } = await compileC(sourceCode);

    if (securityViolation) {
      socket.emit('JOB_RESULT', {
        jobId,
        result: {
          allPassed: false,
          compileError: null,
          securityViolation,
          results: [{ name: 'Test 1', type, status: 'SECURITY_VIOLATION', timeMs: 0, error: securityViolation }],
        },
      });
      return;
    }

    if (compileError || !binPath) {
      socket.emit('JOB_RESULT', {
        jobId,
        result: { allPassed: false, compileError: compileError || 'Compilation failed', securityViolation: null, results: [] },
      });
      return;
    }

    const results: TestCaseEvaluation[] = [];
    let allPassed = true;

    try {
      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const execResult = await runBinary(binPath, tc.input || '', timeoutMs || 2000);
        const actual = normalizeOutput(execResult.output);
        const expected = normalizeOutput(tc.expectedOutput);
        const isMatch = execResult.success && (expected === '' || actual === expected);
        if (!isMatch) allPassed = false;

        results.push({
          name: `Test Case ${i + 1}`,
          type,
          status: execResult.error === 'TIME_LIMIT_EXCEEDED' ? 'TIME_LIMIT_EXCEEDED' : !execResult.success ? 'RUNTIME_ERROR' : isMatch ? 'PASSED' : 'FAILED',
          timeMs: execResult.timeMs || 0,
          actualOutput: execResult.output,
          expectedOutput: tc.expectedOutput,
        });
      }
    } finally {
      await cleanup();
    }

    socket.emit('JOB_RESULT', { jobId, result: { allPassed, compileError: null, securityViolation: null, results } });
  } catch (err: any) {
    socket.emit('JOB_RESULT', { jobId, error: err.message || 'Worker execution error' });
  }
});

// ── LIVE LOCAL RUNNER GUI SERVER (Port 3005) ─────────────────────────────────
const guiServer = http.createServer((req, res) => {
  const activeWorkers = workers.filter((w) => w.status !== 'WORKER_IDLE');
  const runningCount = activeWorkers.length;
  const queuedCount = Math.max(0, totalRunJobs - totalCompleted - totalFailed - runningCount);

  if (req.url === '/api/state') {
    const telemetry = getSystemTelemetry();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(
      JSON.stringify({
        connected: isConnected,
        workerName: WORKER_NAME,
        concurrency: CONCURRENCY,
        runId: currentRunId,
        counts: {
          total: totalRunJobs,
          running: runningCount,
          queued: queuedCount,
          completed: totalCompleted,
          failed: totalFailed,
        },
        workers: workers.map((w) => ({
          id: w.id,
          name: w.name,
          slotKey: w.slotKey,
          status: w.status,
          currentJob: w.activeJob
            ? {
                jobId: w.activeJob.jobId,
                testUserId: w.activeJob.testUserId,
                stage: w.activeJob.stage,
                elapsedMs: Date.now() - w.activeJob.startTime,
                compileTimeMs: w.activeJob.compileTimeMs,
                executionTimeMs: w.activeJob.executionTimeMs,
                cpu: w.activeJob.cpu,
              }
            : null,
          completedCount: w.completedJobsCount,
          failedCount: w.failedJobsCount,
        })),
        queuedMetadata: queuedJobsMetadata.slice(0, 100),
        telemetry,
      })
    );
    return;
  }

  // Standalone Live HTML Dashboard
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SASI C Runner - Strict 8-Worker Pool Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0b1120; color: #f8fafc; margin: 0; padding: 24px; }
    h1 { margin-top: 0; font-size: 22px; color: #38bdf8; display: flex; align-items: center; justify-content: space-between; }
    .status-badge { font-size: 13px; padding: 4px 12px; border-radius: 9999px; background: #10b981; color: #022c22; font-weight: 700; }
    .disconnected { background: #ef4444; color: #fff; }
    .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin: 18px 0; }
    .card { background: #1e293b; padding: 14px; border-radius: 8px; border: 1px solid #334155; }
    .card-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
    .card-val { font-size: 24px; font-weight: 700; margin-top: 4px; }
    .bar-wrap { background: #334155; border-radius: 6px; height: 12px; overflow: hidden; margin: 16px 0; }
    .bar-fill { background: linear-gradient(90deg, #38bdf8, #2563eb); height: 100%; width: 0%; transition: width 0.2s; }
    
    .worker-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 20px 0; }
    .worker-card { background: #131d31; border: 1px solid #233554; border-radius: 8px; padding: 14px; transition: border-color 0.2s; }
    .worker-card.active { border-color: #38bdf8; background: #172544; }
    .worker-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .worker-title { font-size: 14px; font-weight: 700; color: #f1f5f9; }
    .stage-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
    .stage-idle { background: #334155; color: #94a3b8; }
    .stage-assigned { background: #475569; color: #e2e8f0; }
    .stage-compiling { background: #0369a1; color: #e0f2fe; }
    .stage-compiled { background: #0284c7; color: #bae6fd; }
    .stage-executing { background: #b45309; color: #fef3c7; }
    .stage-completed { background: #047857; color: #d1fae5; }
    .stage-failed { background: #b91c1c; color: #fee2e2; }
    
    .worker-detail { font-size: 12px; color: #cbd5e1; margin-top: 6px; }
    .worker-detail strong { color: #f8fafc; }
    
    .queue-section { margin-top: 28px; background: #1e293b; padding: 18px; border-radius: 8px; border: 1px solid #334155; }
    .queue-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; max-height: 180px; overflow-y: auto; }
    .queue-chip { background: #0f172a; border: 1px solid #334155; padding: 4px 10px; border-radius: 6px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>
    <span>⚡ SASI Local C Runner — Strict 8-Worker Execution Pool</span>
    <span id="connBadge" class="status-badge">CONNECTED</span>
  </h1>
  <div style="font-size: 13px; color: #94a3b8; margin-bottom: 12px;">
    Active Run: <strong id="runId" style="color:#38bdf8;">${currentRunId}</strong> | 
    Engine: <strong>GCC 13.3 -O2 / Linux Sandbox</strong> | 
    Pool Limit: <strong style="color:#10b981;">Strict 8 Workers Max</strong>
  </div>

  <div class="bar-wrap">
    <div id="progressBar" class="bar-fill"></div>
  </div>

  <div class="grid">
    <div class="card"><div class="card-label">Workers</div><div id="workerCountVal" class="card-val" style="color:#38bdf8;">0 / 8</div></div>
    <div class="card"><div class="card-label">Running Active</div><div id="runningVal" class="card-val" style="color:#fbbf24;">0</div></div>
    <div class="card"><div class="card-label">Queued (in DB)</div><div id="queuedVal" class="card-val" style="color:#a855f7;">120</div></div>
    <div class="card"><div class="card-label">Completed</div><div id="completedVal" class="card-val" style="color:#10b981;">0</div></div>
    <div class="card"><div class="card-label">Failed</div><div id="failedVal" class="card-val" style="color:#ef4444;">0</div></div>
  </div>

  <div class="grid" style="grid-template-columns: repeat(3, 1fr);">
    <div class="card"><div class="card-label">Host RAM Used</div><div id="ramVal" class="card-val">-- GB</div></div>
    <div class="card"><div class="card-label">Package Temp</div><div id="tempVal" class="card-val">-- °C</div></div>
    <div class="card"><div class="card-label">Active Processes / Compilers</div><div id="procVal" class="card-val">&le; 8</div></div>
  </div>

  <h3 style="margin-top: 24px; color: #94a3b8; font-size: 15px;">8 Parallel Execution Worker Slots</h3>
  <div id="workerCards" class="worker-grid"></div>

  <div class="queue-section">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0; font-size: 15px; color: #94a3b8;">Durable Database Queue (Supabase PostgreSQL)</h3>
      <span id="queueMetaText" style="font-size: 12px; color: #64748b;">Source codes are fetched on-demand per free worker</span>
    </div>
    <div id="queueChips" class="queue-chips"></div>
  </div>

  <script>
    async function updateDashboard() {
      try {
        const res = await fetch('/api/state');
        const data = await res.json();

        document.getElementById('connBadge').textContent = data.connected ? 'CONNECTED' : 'DISCONNECTED';
        document.getElementById('connBadge').className = data.connected ? 'status-badge' : 'status-badge disconnected';
        document.getElementById('runId').textContent = data.runId || 'None';

        const c = data.counts || {};
        const running = c.running || 0;
        const queued = c.queued || 0;
        const completed = c.completed || 0;
        const failed = c.failed || 0;
        const total = c.total || 120;
        const finished = completed + failed;
        const pct = total > 0 ? Math.round((finished / total) * 100) : 0;

        document.getElementById('progressBar').style.width = pct + '%';
        document.getElementById('workerCountVal').textContent = running + ' / ' + data.concurrency;
        document.getElementById('runningVal').textContent = running;
        document.getElementById('queuedVal').textContent = queued;
        document.getElementById('completedVal').textContent = completed;
        document.getElementById('failedVal').textContent = failed;

        document.getElementById('ramVal').textContent = (data.telemetry?.usedGb || '--') + ' GB';
        document.getElementById('tempVal').textContent = (data.telemetry?.pkgTemp || '--') + ' °C';
        document.getElementById('procVal').textContent = running + ' active';

        // Render 8 Worker Cards
        const grid = document.getElementById('workerCards');
        grid.innerHTML = (data.workers || []).map(w => {
          const isAct = w.status !== 'WORKER_IDLE';
          const job = w.currentJob;
          const stageClass = 'stage-' + (w.status ? w.status.toLowerCase().replace('worker_', '') : 'idle');
          return '<div class="worker-card ' + (isAct ? 'active' : '') + '">' +
            '<div class="worker-header">' +
              '<span class="worker-title">' + w.name + '</span>' +
              '<span class="stage-badge ' + stageClass + '">' + (w.status || 'IDLE') + '</span>' +
            '</div>' +
            '<div class="worker-detail">Job: <strong>' + (job ? job.testUserId : '(Free / Idle)') + '</strong></div>' +
            '<div class="worker-detail">Stage: <strong>' + (job ? job.stage : 'AWAITING CLAIM') + '</strong></div>' +
            '<div class="worker-detail">Elapsed: <strong>' + (job ? job.elapsedMs + ' ms' : '--') + '</strong></div>' +
            '<div class="worker-detail">Done / Fail: <strong>' + w.completedCount + ' / ' + w.failedCount + '</strong></div>' +
          '</div>';
        }).join('');

        // Render Queued Chips
        const chipsContainer = document.getElementById('queueChips');
        if (data.queuedMetadata && data.queuedMetadata.length > 0) {
          chipsContainer.innerHTML = data.queuedMetadata.map(q =>
            '<span class="queue-chip">' + q.testUserId + '</span>'
          ).join('');
        } else if (queued > 0) {
          chipsContainer.innerHTML = '<span style="color:#64748b; font-size:12px;">' + queued + ' jobs queued in Supabase</span>';
        } else {
          chipsContainer.innerHTML = '<span style="color:#10b981; font-size:12px;">Queue Empty — All jobs claimed & completed!</span>';
        }

      } catch (err) {
        console.error(err);
      }
    }

    setInterval(updateDashboard, 300);
    updateDashboard();
  </script>
</body>
</html>`);
});

guiServer.listen(GUI_PORT, () => {
  console.log(`[✓] Strict 8-Worker Local Runner GUI ready at: http://localhost:${GUI_PORT}`);
});

// Terminal ticker
setInterval(() => {
  if (!isConnected) return;
  const activeWorkers = workers.filter((w) => w.status !== 'WORKER_IDLE');
  const running = activeWorkers.length;
  const queued = Math.max(0, totalRunJobs - totalCompleted - totalFailed - running);
  const telemetry = getSystemTelemetry();
  process.stdout.write(
    `\r[Runner Pool] Status: CONNECTED | Run: ${currentRunId} | Workers: ${running}/${CONCURRENCY} Busy | Running: ${running} | Queued: ${queued} | Done: ${totalCompleted} | Fail: ${totalFailed} | RAM: ${telemetry.usedGb}GB | Temp: ${telemetry.pkgTemp}°C `
  );
}, 500);
