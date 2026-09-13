import { execFile, exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { isRunnerAvailable, executeRemoteJob } from './runnerBridge';

export interface ExecutionResult {
  success: boolean;
  error: 'COMPILATION_ERROR' | 'TIME_LIMIT_EXCEEDED' | 'OUTPUT_LIMIT_EXCEEDED' | 'RUNTIME_ERROR' | 'SECURITY_VIOLATION' | null;
  output: string;
  timeMs: number;
}

export interface TestCase {
  input: string;
  expectedOutput: string;
}

export interface TestCaseEvaluation {
  name: string;
  type: 'SAMPLE' | 'HIDDEN';
  status: 'PASSED' | 'FAILED' | 'TIME_LIMIT_EXCEEDED' | 'OUTPUT_LIMIT_EXCEEDED' | 'RUNTIME_ERROR' | 'SECURITY_VIOLATION';
  timeMs: number;
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  error?: string;
}

export interface QueueTimings {
  queueEnterTime: number;
  workerAssignedTime: number;
  queueWaitMs: number;
  activeAtStart: number;
  queueDepthAtStart: number;
}

export interface ExecutionTimingMetrics {
  queueEnterTime: number;
  workerAssignedTime: number;
  compileStartTime: number;
  compileEndTime: number;
  executionStartTime: number;
  executionEndTime: number;
  queueWaitMs: number;
  compileTimeMs: number;
  executionTimeMs: number;
  totalServerTimeMs: number;
  concurrencyAtStart: number;
  queueDepthAtStart: number;
}

/**
 * Concurrency limiter to manage GCC compilations and binary executions.
 * Default max concurrency 8 to maximize CPU utilization without thrashing.
 */
export function createConcurrencyLimiter(maxConcurrency: number = 8) {
  const queue: Array<() => void> = [];
  let activeCount = 0;
  let peakActiveCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const nextTask = queue.shift();
      if (nextTask) nextTask();
    }
  };

  const run = async <T>(
    fn: (timings: QueueTimings) => Promise<T>,
    queueEnterTime: number,
    queueDepthAtStart: number
  ): Promise<T> => {
    activeCount++;
    if (activeCount > peakActiveCount) {
      peakActiveCount = activeCount;
    }
    const workerAssignedTime = Date.now();
    const queueWaitMs = workerAssignedTime - queueEnterTime;
    const activeAtStart = activeCount;

    try {
      return await fn({ queueEnterTime, workerAssignedTime, queueWaitMs, activeAtStart, queueDepthAtStart });
    } finally {
      next();
    }
  };

  const enqueue = <T>(fn: (timings: QueueTimings) => Promise<T>): Promise<T> => {
    const queueEnterTime = Date.now();
    const queueDepthAtStart = queue.length;

    return new Promise<T>((resolve, reject) => {
      const task = () => {
        run(fn, queueEnterTime, queueDepthAtStart).then(resolve, reject);
      };

      if (activeCount < maxConcurrency) {
        task();
      } else {
        queue.push(task);
      }
    });
  };

  enqueue.getActiveCount = () => activeCount;
  enqueue.getQueueDepth = () => queue.length;
  enqueue.getPeakActive = () => peakActiveCount;
  enqueue.getMaxConcurrency = () => maxConcurrency;

  return enqueue;
}

export const cExecutionQueue = createConcurrencyLimiter(8);

// ── In-Memory Per-User Rate Limiting for Run & Submit ──────────────────────
const userLastExecutionMap = new Map<string, number>();

export function checkUserExecutionRateLimit(
  userId: string,
  minIntervalMs: number = 2000
): { allowed: boolean; remainingCooldownMs: number } {
  const now = Date.now();
  const lastTime = userLastExecutionMap.get(userId) || 0;
  const elapsed = now - lastTime;

  if (elapsed < minIntervalMs) {
    return {
      allowed: false,
      remainingCooldownMs: minIntervalMs - elapsed,
    };
  }

  userLastExecutionMap.set(userId, now);
  // Periodic cleanup if map grows too large
  if (userLastExecutionMap.size > 2000) {
    const cutoff = now - 60000;
    for (const [uid, time] of userLastExecutionMap.entries()) {
      if (time < cutoff) userLastExecutionMap.delete(uid);
    }
  }

  return { allowed: true, remainingCooldownMs: 0 };
}

const DANGEROUS_PATTERNS = [
  // OS & System headers
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
  // Process spawning and control
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
  // File access and tampering
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
  // Inline assembly and direct syscalls
  /\b__asm__\b/i,
  /\basm\b/i,
  /\bsyscall\s*\(/i,
];

export function normalizeOutput(s: string): string {
  if (!s) return '';
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Compile source code once into an executable binary.
 */
export async function compileCSource(sourceCode: string): Promise<{
  binPath: string | null;
  cleanup: () => Promise<void>;
  securityViolation: string | null;
  compileError: string | null;
}> {
  // 1. Security Check: Block dangerous keywords
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
  const tempDir = path.join(tmpdir(), 'sasi-debugging-sandbox');
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
  } catch (err: unknown) {
    await cleanup();
    return {
      binPath: null,
      cleanup: async () => {},
      securityViolation: null,
      compileError: `Failed to write temporary source file: ${(err as Error).message}`,
    };
  }

  // Compile using GCC with O2 optimization, math library, and 5s compile timeout
  const compileResult = await new Promise<{ error: Error | null; stderr: string; stdout: string }>((res) => {
    const compileCmd = `gcc "${srcPath}" -o "${binPath}" -lm -O2 -w`;
    exec(compileCmd, { cwd: tempDir, timeout: 5000, maxBuffer: 32 * 1024 }, (err, stdout, stderr) => {
      res({ error: err, stderr, stdout });
    });
  });

  if (compileResult.error) {
    await cleanup();
    const errMsg = compileResult.stderr || compileResult.error.message || 'Compilation failed';
    const isGccMissing =
      errMsg.toLowerCase().includes('not recognized') ||
      errMsg.toLowerCase().includes('command not found') ||
      (compileResult.error as any)?.code === 'ENOENT';

    const diagnosticOutput = isGccMissing
      ? 'GCC Compiler Error: "gcc" command not found in system PATH. Ensure GCC is installed.'
      : errMsg;

    return {
      binPath: null,
      cleanup: async () => {},
      securityViolation: null,
      compileError: diagnosticOutput,
    };
  }

  return {
    binPath,
    cleanup,
    securityViolation: null,
    compileError: null,
  };
}

const HAS_PRLIMIT = process.platform === 'linux';

/**
 * Execute an already compiled binary against input with time & output limits.
 */
export function runCompiledBinary(
  binPath: string,
  inputData: string = '',
  timeoutMs: number = 2000
): Promise<ExecutionResult> {
  const startTime = performance.now();
  const safeInput = typeof inputData === 'string' ? inputData.slice(0, 16 * 1024) : '';
  const isolatedDir = path.dirname(binPath);

  return new Promise<ExecutionResult>((resolve) => {
    let resolved = false;

    const finish = (result: ExecutionResult) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const execCommand = HAS_PRLIMIT ? '/usr/bin/prlimit' : binPath;
    const execArgs = HAS_PRLIMIT
      ? ['--as=134217728', '--cpu=2', '--nproc=10', '--fsize=65536', '--nofile=32', binPath]
      : [];

    const child = execFile(
      execCommand,
      execArgs,
      {
        cwd: isolatedDir,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024, // 16 KB output buffer
        windowsHide: true,
      },
      (execErr, stdout, stderrOutput) => {
        const duration = Math.round(performance.now() - startTime);

        if (execErr) {
          if (
            (execErr as any).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
            execErr.message.includes('maxBuffer')
          ) {
            return finish({
              success: false,
              error: 'OUTPUT_LIMIT_EXCEEDED',
              output: 'Output Limit Exceeded: Output exceeded 16KB capacity.',
              timeMs: duration,
            });
          }

          if (execErr.killed || execErr.signal === 'SIGKILL' || duration >= timeoutMs) {
            return finish({
              success: false,
              error: 'TIME_LIMIT_EXCEEDED',
              output: `Time Limit Exceeded: Execution terminated after ${(timeoutMs / 1000).toFixed(1)}s`,
              timeMs: duration,
            });
          }

          return finish({
            success: false,
            error: 'RUNTIME_ERROR',
            output: stderrOutput || execErr.message || 'Runtime execution error',
            timeMs: duration,
          });
        }

        return finish({
          success: true,
          error: null,
          output: stdout || '',
          timeMs: duration,
        });
      }
    );

    if (safeInput && child.stdin) {
      child.stdin.write(safeInput);
      child.stdin.end();
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}

/**
 * Compile source code once, then execute against an array of test cases locally.
 * Speeds up execution by 5x to 10x and protects the server under 120+ student load.
 */
export async function evaluateCWithTestCasesLocal(
  sourceCode: string,
  testCases: TestCase[],
  type: 'SAMPLE' | 'HIDDEN' = 'SAMPLE',
  timeoutMs: number = 2000
): Promise<{
  allPassed: boolean;
  compileError: string | null;
  securityViolation: string | null;
  results: TestCaseEvaluation[];
  metrics?: ExecutionTimingMetrics;
}> {
  return cExecutionQueue(async (qTimings) => {
    // 1. Compile source code ONCE
    const compileStartTime = Date.now();
    const { binPath, cleanup, securityViolation, compileError } = await compileCSource(sourceCode);
    const compileEndTime = Date.now();
    const compileTimeMs = compileEndTime - compileStartTime;

    if (securityViolation) {
      return {
        allPassed: false,
        compileError: null,
        securityViolation,
        results: [
          {
            name: `${type === 'SAMPLE' ? 'Sample' : 'Hidden'} Test Case 1`,
            type,
            status: 'SECURITY_VIOLATION',
            timeMs: 0,
            error: securityViolation,
          },
        ],
        metrics: {
          queueEnterTime: qTimings.queueEnterTime,
          workerAssignedTime: qTimings.workerAssignedTime,
          compileStartTime,
          compileEndTime,
          executionStartTime: compileEndTime,
          executionEndTime: compileEndTime,
          queueWaitMs: qTimings.queueWaitMs,
          compileTimeMs,
          executionTimeMs: 0,
          totalServerTimeMs: Date.now() - qTimings.queueEnterTime,
          concurrencyAtStart: qTimings.activeAtStart,
          queueDepthAtStart: qTimings.queueDepthAtStart,
        },
      };
    }

    if (compileError || !binPath) {
      return {
        allPassed: false,
        compileError: compileError || 'Compilation failed',
        securityViolation: null,
        results: [],
        metrics: {
          queueEnterTime: qTimings.queueEnterTime,
          workerAssignedTime: qTimings.workerAssignedTime,
          compileStartTime,
          compileEndTime,
          executionStartTime: compileEndTime,
          executionEndTime: compileEndTime,
          queueWaitMs: qTimings.queueWaitMs,
          compileTimeMs,
          executionTimeMs: 0,
          totalServerTimeMs: Date.now() - qTimings.queueEnterTime,
          concurrencyAtStart: qTimings.activeAtStart,
          queueDepthAtStart: qTimings.queueDepthAtStart,
        },
      };
    }

    // 2. Execute test cases against pre-compiled binary
    const results: TestCaseEvaluation[] = [];
    let allPassed = true;
    const executionStartTime = Date.now();

    try {
      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const execResult = await runCompiledBinary(binPath, tc.input || '', timeoutMs);

        const actual = normalizeOutput(execResult.output);
        const expected = normalizeOutput(tc.expectedOutput);
        const isMatch = execResult.success && (expected === '' || actual === expected);

        if (!isMatch) {
          allPassed = false;
        }

        results.push({
          name: `${type === 'SAMPLE' ? 'Sample' : 'Hidden'} Test Case ${i + 1}`,
          type,
          status: execResult.error === 'TIME_LIMIT_EXCEEDED'
            ? 'TIME_LIMIT_EXCEEDED'
            : execResult.error === 'OUTPUT_LIMIT_EXCEEDED'
            ? 'OUTPUT_LIMIT_EXCEEDED'
            : execResult.error === 'RUNTIME_ERROR'
            ? 'RUNTIME_ERROR'
            : isMatch
            ? 'PASSED'
            : 'FAILED',
          timeMs: execResult.timeMs || 0,
          input: type === 'SAMPLE' ? tc.input : undefined,
          expectedOutput: type === 'SAMPLE' ? tc.expectedOutput : undefined,
          actualOutput: type === 'SAMPLE' ? execResult.output : undefined,
          error: execResult.error ? execResult.output : undefined,
        });

        // Fast fail on security or crash
        if (execResult.error === 'RUNTIME_ERROR' && results.length > 5) {
          break;
        }
      }
    } finally {
      await cleanup();
    }

    const executionEndTime = Date.now();
    const executionTimeMs = executionEndTime - executionStartTime;

    return {
      allPassed,
      compileError: null,
      securityViolation: null,
      results,
      metrics: {
        queueEnterTime: qTimings.queueEnterTime,
        workerAssignedTime: qTimings.workerAssignedTime,
        compileStartTime,
        compileEndTime,
        executionStartTime,
        executionEndTime,
        queueWaitMs: qTimings.queueWaitMs,
        compileTimeMs,
        executionTimeMs,
        totalServerTimeMs: Date.now() - qTimings.queueEnterTime,
        concurrencyAtStart: qTimings.activeAtStart,
        queueDepthAtStart: qTimings.queueDepthAtStart,
      },
    };
  });
}

/**
 * Evaluates C code against test cases.
 * Dispatches to connected external runner workers if available,
 * and automatically falls back to local execution if no worker is connected
 * or if a worker disconnects/fails.
 */
export async function evaluateCWithTestCases(
  sourceCode: string,
  testCases: TestCase[],
  type: 'SAMPLE' | 'HIDDEN' = 'SAMPLE',
  timeoutMs: number = 2000
): Promise<{
  allPassed: boolean;
  compileError: string | null;
  securityViolation: string | null;
  results: TestCaseEvaluation[];
  metrics?: ExecutionTimingMetrics;
}> {
  if (isRunnerAvailable()) {
    try {
      return await executeRemoteJob(sourceCode, testCases, type, timeoutMs);
    } catch (err: any) {
      console.warn(`[Runner Bridge] Remote runner execution failed: ${err.message}. Falling back to local execution.`);
    }
  }

  return evaluateCWithTestCasesLocal(sourceCode, testCases, type, timeoutMs);
}

/**
 * Backward compatibility helper for single execution
 */
export async function compileAndRunC(
  sourceCode: string,
  inputData: string = '',
  timeoutMs: number = 2000
): Promise<ExecutionResult> {
  const evalResult = await evaluateCWithTestCases(
    sourceCode,
    [{ input: inputData, expectedOutput: '' }],
    'SAMPLE',
    timeoutMs
  );

  if (evalResult.securityViolation) {
    return {
      success: false,
      error: 'SECURITY_VIOLATION',
      output: evalResult.securityViolation,
      timeMs: 0,
    };
  }

  if (evalResult.compileError) {
    return {
      success: false,
      error: 'COMPILATION_ERROR',
      output: evalResult.compileError,
      timeMs: 0,
    };
  }

  const res = evalResult.results[0];
  return {
    success: res?.status === 'PASSED',
    error: res?.status === 'TIME_LIMIT_EXCEEDED' ? 'TIME_LIMIT_EXCEEDED' : res?.status === 'RUNTIME_ERROR' ? 'RUNTIME_ERROR' : null,
    output: res?.actualOutput || res?.error || '',
    timeMs: res?.timeMs || 0,
  };
}
