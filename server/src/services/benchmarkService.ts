import prisma from '../utils/prisma';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export interface BenchmarkRun {
  id: string;
  name: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalWallTimeMs: number;
}

export interface BenchmarkJob {
  id: string;
  runId: string;
  testUserId: string;
  language: string;
  sourceCode: string;
  input: string;
  expectedOutput: string;
  status: 'QUEUED' | 'ASSIGNED' | 'COMPILING' | 'EXECUTING' | 'PASSED' | 'FAILED' | 'COMPILE_ERROR' | 'RUNTIME_ERROR' | 'TIMEOUT';
  workerId?: string | null;
  createdAt: Date;
  queuedAt?: Date | null;
  assignedAt?: Date | null;
  compileStartedAt?: Date | null;
  compileCompletedAt?: Date | null;
  executionStartedAt?: Date | null;
  executionCompletedAt?: Date | null;
  completedAt?: Date | null;
  compileTimeMs: number;
  executionTimeMs: number;
  queueWaitMs: number;
  totalTimeMs: number;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  errorMessage?: string | null;
}

export interface BenchmarkEvent {
  id: string;
  runId: string;
  jobId?: string | null;
  eventType: string;
  workerId?: string | null;
  testUserId?: string | null;
  timestamp: Date;
  payload: any;
}

let ioInstance: Server | null = null;
let currentActiveRunId: string | null = null;
let isRunnerProcessing = false;

export function setBenchmarkIo(io: Server) {
  ioInstance = io;
}

/**
 * 1. Initialize dedicated isolated benchmark tables in PostgreSQL (Supabase)
 */
export async function initBenchmarkTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS runner_benchmark_runs (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "startedAt" TIMESTAMPTZ,
      "completedAt" TIMESTAMPTZ,
      "totalJobs" INT NOT NULL DEFAULT 120,
      "completedJobs" INT NOT NULL DEFAULT 0,
      "failedJobs" INT NOT NULL DEFAULT 0,
      "totalWallTimeMs" INT DEFAULT 0
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS runner_benchmark_jobs (
      id VARCHAR(64) PRIMARY KEY,
      "runId" VARCHAR(64) NOT NULL REFERENCES runner_benchmark_runs(id) ON DELETE CASCADE,
      "testUserId" VARCHAR(64) NOT NULL,
      language VARCHAR(32) NOT NULL DEFAULT 'c',
      "sourceCode" TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      "expectedOutput" TEXT NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
      "workerId" VARCHAR(64),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "queuedAt" TIMESTAMPTZ,
      "assignedAt" TIMESTAMPTZ,
      "compileStartedAt" TIMESTAMPTZ,
      "compileCompletedAt" TIMESTAMPTZ,
      "executionStartedAt" TIMESTAMPTZ,
      "executionCompletedAt" TIMESTAMPTZ,
      "completedAt" TIMESTAMPTZ,
      "compileTimeMs" INT DEFAULT 0,
      "executionTimeMs" INT DEFAULT 0,
      "queueWaitMs" INT DEFAULT 0,
      "totalTimeMs" INT DEFAULT 0,
      stdout VARCHAR(10240) DEFAULT '',
      stderr VARCHAR(10240) DEFAULT '',
      "exitCode" INT,
      "errorMessage" TEXT DEFAULT ''
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_bench_jobs_run_status_created 
    ON runner_benchmark_jobs ("runId", status, "createdAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS runner_benchmark_events (
      id VARCHAR(64) PRIMARY KEY,
      "runId" VARCHAR(64) NOT NULL REFERENCES runner_benchmark_runs(id) ON DELETE CASCADE,
      "jobId" VARCHAR(64),
      "eventType" VARCHAR(64) NOT NULL,
      "workerId" VARCHAR(64),
      "testUserId" VARCHAR(64),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_bench_events_run_time 
    ON runner_benchmark_events ("runId", timestamp);
  `);
}

/**
 * 2. Seed exactly 120 dedicated benchmark users (BENCH001 - BENCH120)
 */
export async function seedBenchmarkUsers(count: number = 120): Promise<string[]> {
  const users: string[] = [];
  const bcrypt = await import('bcryptjs');
  const dummyHash = await bcrypt.hash('bench-pass-2026', 10);

  for (let i = 1; i <= count; i++) {
    const rollNo = `BENCH${String(i).padStart(3, '0')}`;
    const name = `Benchmark Test Student ${String(i).padStart(3, '0')}`;
    const id = `bench_user_${String(i).padStart(3, '0')}`;

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "User" ("id", "rollNo", "name", "passwordHash", "role", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, 'BENCHMARK', NOW(), NOW())
      ON CONFLICT ("rollNo") DO UPDATE SET "role" = 'BENCHMARK';
    `,
      id,
      rollNo,
      name,
      dummyHash
    );

    users.push(rollNo);
  }

  return users;
}

/**
 * 3. Create a benchmark run and populate 120 jobs with the large DSA C program
 */
export async function createBenchmarkRun(
  runName: string = 'Real DB C Runner 120-User Benchmark',
  jobCount: number = 120
): Promise<{ runId: string; jobCount: number }> {
  await initBenchmarkTables();
  await seedBenchmarkUsers(jobCount);

  const runId = `TEST_RUNNER_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  currentActiveRunId = runId;

  // Read large DSA C source program
  const dsaPath = path.resolve(__dirname, '../../scratch/test_dsa_program.c');
  let dsaSourceCode = '';
  try {
    dsaSourceCode = fs.readFileSync(dsaPath, 'utf-8');
  } catch {
    // Fallback path
    const fallbackPath = '/home/candy/.gemini/antigravity-cli/brain/06c27ae5-666d-4624-b909-5d79e889b953/scratch/test_dsa_program.c';
    dsaSourceCode = fs.readFileSync(fallbackPath, 'utf-8');
  }

  const expectedOutput = 'DSA_BENCHMARK_OK: CHECKSUM=295953 | BS_IDX=379 | DP_VAL=5591 | REACHABLE=120';

  // Insert Run
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO runner_benchmark_runs (id, name, status, "createdAt", "totalJobs", "completedJobs", "failedJobs")
    VALUES ($1, $2, 'QUEUED', NOW(), $3, 0, 0);
  `,
    runId,
    runName,
    jobCount
  );

  // Insert 120 Jobs
  for (let i = 1; i <= jobCount; i++) {
    const jobId = `job_${runId}_${String(i).padStart(3, '0')}`;
    const testUserId = `BENCH${String(i).padStart(3, '0')}`;

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO runner_benchmark_jobs (
        id, "runId", "testUserId", language, "sourceCode", input, "expectedOutput", status, "createdAt", "queuedAt"
      )
      VALUES ($1, $2, $3, 'c', $4, '', $5, 'QUEUED', NOW(), NOW());
    `,
      jobId,
      runId,
      testUserId,
      dsaSourceCode,
      expectedOutput
    );
  }

  // Record initial event
  await recordBenchmarkEvent(runId, null, 'JOB_CREATED', null, null, { totalJobs: jobCount });
  await recordBenchmarkEvent(runId, null, 'JOB_QUEUED', null, null, { totalJobs: jobCount });

  broadcastStateUpdate();
  return { runId, jobCount };
}

/**
 * 4. Record real-time event in Supabase and broadcast over WebSocket
 */
export async function recordBenchmarkEvent(
  runId: string,
  jobId: string | null,
  eventType: string,
  workerId: string | null,
  testUserId: string | null,
  payload: any = {}
): Promise<void> {
  const eventId = `ev_${randomUUID()}`;
  const now = new Date();

  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO runner_benchmark_events (id, "runId", "jobId", "eventType", "workerId", "testUserId", timestamp, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb);
    `,
      eventId,
      runId,
      jobId,
      eventType,
      workerId,
      testUserId,
      now,
      JSON.stringify(payload)
    );
  } catch (err: any) {
    console.error(`[Benchmark Event DB Error] ${eventType}:`, err.message);
  }

  // Broadcast live via Socket.IO
  if (ioInstance) {
    const eventObj = {
      id: eventId,
      runId,
      jobId,
      eventType,
      workerId,
      testUserId,
      timestamp: now.toISOString(),
      payload,
    };
    ioInstance.emit('runner_benchmark:event', eventObj);
    ioInstance.of('/runner').emit('runner_benchmark:event', eventObj);
  }
}

/**
 * 5. Safe Transactional Job Claiming: FOR UPDATE SKIP LOCKED
 * Guarantees zero duplicate execution across multiple workers.
 */
export async function claimNextQueuedJob(
  runId: string,
  workerId: string
): Promise<BenchmarkJob | null> {
  const claimed = await prisma.$queryRawUnsafe<any[]>(
    `
    UPDATE runner_benchmark_jobs
    SET status = 'ASSIGNED',
        "assignedAt" = NOW(),
        "workerId" = $1
    WHERE id = (
      SELECT id
      FROM runner_benchmark_jobs
      WHERE "runId" = $2 AND status = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `,
    workerId,
    runId
  );

  if (!claimed || claimed.length === 0) {
    return null;
  }

  const job = claimed[0] as BenchmarkJob;
  await recordBenchmarkEvent(runId, job.id, 'JOB_ASSIGNED', workerId, job.testUserId, {
    assignedAt: new Date().toISOString(),
  });

  return job;
}

/**
 * 6. Save job execution result atomically to Supabase and emit events
 */
export async function saveJobResult(
  jobId: string,
  result: {
    status: 'PASSED' | 'FAILED' | 'COMPILE_ERROR' | 'RUNTIME_ERROR' | 'TIMEOUT';
    workerId: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    compileTimeMs: number;
    executionTimeMs: number;
    totalTimeMs: number;
    errorMessage?: string;
  }
): Promise<void> {
  const now = new Date();

  const jobs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM runner_benchmark_jobs WHERE id = $1 LIMIT 1;`,
    jobId
  );
  if (!jobs || jobs.length === 0) return;
  const job = jobs[0];

  const queueWaitMs = job.assignedAt && job.queuedAt
    ? Math.max(0, new Date(job.assignedAt).getTime() - new Date(job.queuedAt).getTime())
    : 0;

  await prisma.$executeRawUnsafe(
    `
    UPDATE runner_benchmark_jobs
    SET status = $1,
        "workerId" = $2,
        stdout = $3,
        stderr = $4,
        "exitCode" = $5,
        "compileTimeMs" = $6,
        "executionTimeMs" = $7,
        "totalTimeMs" = $8,
        "queueWaitMs" = $9,
        "errorMessage" = $10,
        "completedAt" = $11
    WHERE id = $12;
  `,
    result.status,
    result.workerId,
    result.stdout.slice(0, 10240),
    result.stderr.slice(0, 10240),
    result.exitCode,
    result.compileTimeMs,
    result.executionTimeMs,
    result.totalTimeMs,
    queueWaitMs,
    result.errorMessage || '',
    now,
    jobId
  );

  const isPass = result.status === 'PASSED';
  await prisma.$executeRawUnsafe(
    `
    UPDATE runner_benchmark_runs
    SET "completedJobs" = "completedJobs" + (CASE WHEN $1 THEN 1 ELSE 0 END),
        "failedJobs" = "failedJobs" + (CASE WHEN $1 THEN 0 ELSE 1 END)
    WHERE id = $2;
  `,
    isPass,
    job.runId
  );

  await recordBenchmarkEvent(
    job.runId,
    jobId,
    isPass ? 'JOB_COMPLETED' : 'JOB_FAILED',
    result.workerId,
    job.testUserId,
    {
      status: result.status,
      compileTimeMs: result.compileTimeMs,
      executionTimeMs: result.executionTimeMs,
      totalTimeMs: result.totalTimeMs,
      queueWaitMs,
    }
  );

  await recordBenchmarkEvent(job.runId, jobId, 'RESULT_SAVED', result.workerId, job.testUserId, {
    status: result.status,
  });

  broadcastStateUpdate();
}

/**
 * 7. Broadcast aggregated run state to all connected Admin & Runner GUIs
 */
export async function broadcastStateUpdate(): Promise<void> {
  if (!ioInstance) return;
  const state = await getBenchmarkLiveState();
  if (state) {
    ioInstance.emit('runner_benchmark:status', state);
    ioInstance.of('/runner').emit('runner_benchmark:status', state);
  }
}

/**
 * 8. Retrieve complete live state for Admin & Runner GUI
 */
export async function getBenchmarkLiveState(runId?: string): Promise<any> {
  const targetRunId = runId || currentActiveRunId;
  if (!targetRunId) return null;

  const runs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM runner_benchmark_runs WHERE id = $1 LIMIT 1;`,
    targetRunId
  );
  if (!runs || runs.length === 0) return null;
  const run = runs[0];

  const jobs = await prisma.$queryRawUnsafe<any[]>(
    `
    SELECT id, "testUserId", status, "workerId", "compileTimeMs", "executionTimeMs", "queueWaitMs", "totalTimeMs", "assignedAt", "completedAt"
    FROM runner_benchmark_jobs
    WHERE "runId" = $1
    ORDER BY "createdAt" ASC;
  `,
    targetRunId
  );

  const recentEvents = await prisma.$queryRawUnsafe<any[]>(
    `
    SELECT id, "jobId", "eventType", "workerId", "testUserId", timestamp, payload
    FROM runner_benchmark_events
    WHERE "runId" = $1
    ORDER BY timestamp DESC
    LIMIT 50;
  `,
    targetRunId
  );

  const counts = {
    total: run.totalJobs,
    queued: jobs.filter((j) => j.status === 'QUEUED').length,
    running: jobs.filter((j) => j.status === 'ASSIGNED' || j.status === 'COMPILING' || j.status === 'EXECUTING').length,
    assigned: jobs.filter((j) => j.status === 'ASSIGNED' || j.status === 'COMPILING' || j.status === 'EXECUTING').length,
    completed: jobs.filter((j) => j.status === 'PASSED').length,
    failed: jobs.filter((j) => j.status !== 'PASSED' && j.status !== 'QUEUED' && j.status !== 'ASSIGNED' && j.status !== 'COMPILING' && j.status !== 'EXECUTING').length,
  };
  const queuedMetadata = jobs.filter((j) => j.status === 'QUEUED').map((j) => ({ id: j.id, testUserId: j.testUserId }));

  // Performance calculations
  const finishedJobs = jobs.filter((j) => j.status === 'PASSED' || j.status === 'FAILED');
  const compileTimes = finishedJobs.map((j) => j.compileTimeMs || 0).sort((a, b) => a - b);
  const execTimes = finishedJobs.map((j) => j.executionTimeMs || 0).sort((a, b) => a - b);
  const queueWaits = finishedJobs.map((j) => j.queueWaitMs || 0).sort((a, b) => a - b);
  const totalTimes = finishedJobs.map((j) => j.totalTimeMs || 0).sort((a, b) => a - b);

  const calcPct = (arr: number[]) => {
    if (arr.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0 };
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const p50 = arr[Math.floor(arr.length * 0.5)];
    const p95 = arr[Math.floor(arr.length * 0.95)] || arr[arr.length - 1];
    const p99 = arr[Math.floor(arr.length * 0.99)] || arr[arr.length - 1];
    return { avg, p50, p95, p99 };
  };

  return {
    run: {
      id: run.id,
      name: run.name,
      status: run.status,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      totalJobs: run.totalJobs,
      completedJobs: run.completedJobs,
      failedJobs: run.failedJobs,
      totalWallTimeMs: run.totalWallTimeMs,
    },
    counts,
    queuedMetadata,
    performance: {
      compile: calcPct(compileTimes),
      execution: calcPct(execTimes),
      queueWait: calcPct(queueWaits),
      total: calcPct(totalTimes),
    },
    activeJobs: jobs.filter((j) => j.status === 'ASSIGNED' || j.status === 'COMPILING' || j.status === 'EXECUTING'),
    recentJobs: jobs.slice(0, 120),
    recentEvents: recentEvents.reverse(),
  };
}

/**
 * 9. Surgical cleanup of benchmark tables and test accounts
 */
export async function cleanupBenchmarkData(): Promise<{ deletedUsers: number; droppedTables: boolean }> {
  let deletedUsers = 0;
  try {
    const res = await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "rollNo" LIKE 'BENCH%';`);
    deletedUsers = Number(res);
  } catch {}

  try {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS runner_benchmark_events CASCADE;`);
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS runner_benchmark_jobs CASCADE;`);
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS runner_benchmark_runs CASCADE;`);
  } catch {}

  currentActiveRunId = null;
  return { deletedUsers, droppedTables: true };
}
