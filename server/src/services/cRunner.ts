import { execFile, exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';

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

/**
 * In-memory concurrency limiter (matches p-limit functionality, zero ESM overhead)
 * Capped to 4 concurrent GCC compilations/executions to match 4 performance cores.
 */
export function createConcurrencyLimiter(maxConcurrency: number = 4) {
  const queue: Array<() => void> = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const nextTask = queue.shift();
      if (nextTask) nextTask();
    }
  };

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    activeCount++;
    try {
      return await fn();
    } finally {
      next();
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const task = () => {
        run(fn).then(resolve, reject);
      };

      if (activeCount < maxConcurrency) {
        task();
      } else {
        queue.push(task);
      }
    });
  };
}

export const cExecutionQueue = createConcurrencyLimiter(4);

const DANGEROUS_PATTERNS = [
  /#include\s*<sys\/.*>/i,
  /#include\s*<windows\.h>/i,
  /#include\s*<unistd\.h>/i,
  /#include\s*<process\.h>/i,
  /#include\s*<fstream>/i,
  /#include\s*<dirent\.h>/i,
  /#include\s*<signal\.h>/i,
  /#include\s*<pthread\.h>/i,
  /\bsystem\s*\(/i,
  /\bfork\s*\(/i,
  /\bexec[lvpe]*\s*\(/i,
  /\bpopen\s*\(/i,
  /\bkill\s*\(/i,
  /\bptrace\s*\(/i,
  /\bsetuid\s*\(/i,
  /\bsetgid\s*\(/i,
  /\bchmod\s*\(/i,
  /\bremove\s*\(/i,
  /\brename\s*\(/i,
  /\bunlink\s*\(/i,
  /\bmkdir\s*\(/i,
  /\brmdir\s*\(/i,
  /\btruncate\s*\(/i,
  /\bchown\s*\(/i,
];

export function normalizeOutput(s: string): string {
  if (!s) return '';
  return s
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Compile and run C source code securely with sandboxing, keyword checks, hard timeouts, and 10KB buffer caps.
 * Queued via cExecutionQueue to prevent CPU spikes under 60-participant load.
 */
export function compileAndRunC(
  sourceCode: string,
  inputData: string = '',
  timeoutMs: number = 2000
): Promise<ExecutionResult> {
  return cExecutionQueue(async () => {
    // 1. Security Check: Block dangerous keywords
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(sourceCode)) {
        return {
          success: false,
          error: 'SECURITY_VIOLATION',
          output: 'Security Violation: Restricted system call or header detected.',
          timeMs: 0,
        };
      }
    }

    // 2. Generate unique temp paths in RAM / tmpfs using crypto.randomUUID()
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
        success: false,
        error: 'RUNTIME_ERROR',
        output: `Failed to write temporary source file: ${(err as Error).message}`,
        timeMs: 0,
      };
    }

    // 3. Compile Source Code (Capped at 5.0s compilation)
    const compileResult = await new Promise<{ error: Error | null; stderr: string; stdout: string }>((res) => {
      const compileCmd = `gcc "${srcPath}" -o "${binPath}" -lm -Wall -w`;
      exec(compileCmd, { timeout: 5000, maxBuffer: 10 * 1024 }, (err, stdout, stderr) => {
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
        ? 'GCC Compiler Error: "gcc" command not found in system PATH. Ensure GCC / MinGW is installed on the host system.'
        : errMsg;

      return {
        success: false,
        error: 'COMPILATION_ERROR',
        output: diagnosticOutput,
        timeMs: 0,
      };
    }

    // 4. Execute the binary with stdin, 2.0s hard timeout, and 10KB maxBuffer
    const startTime = performance.now();

    return new Promise<ExecutionResult>((resolve) => {
      let resolved = false;

      const finish = async (result: ExecutionResult) => {
        if (!resolved) {
          resolved = true;
          await cleanup();
          resolve(result);
        }
      };

      const child = execFile(
        binPath,
        [],
        {
          timeout: timeoutMs,
          killSignal: 'SIGTERM',
          maxBuffer: 10 * 1024, // 10 KB buffer cap (prevents infinite printf heap crashes)
          windowsHide: true,
        },
        (execErr, stdout, stderrOutput) => {
          const duration = Math.round(performance.now() - startTime);

          if (execErr) {
            // Buffer overflow detection (infinite loop with printf)
            if (
              (execErr as any).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
              execErr.message.includes('maxBuffer')
            ) {
              return finish({
                success: false,
                error: 'OUTPUT_LIMIT_EXCEEDED',
                output: 'Output Limit Exceeded: Output exceeded 10KB buffer capacity.',
                timeMs: duration,
              });
            }

            // Timeout detection
            if (execErr.killed || execErr.signal === 'SIGTERM' || duration >= timeoutMs) {
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

      // Write stdin data
      if (inputData && child.stdin) {
        child.stdin.write(inputData);
        child.stdin.end();
      } else if (child.stdin) {
        child.stdin.end();
      }
    });
  });
}

/**
 * Execute against an array of test cases
 */
export async function evaluateCWithTestCases(
  sourceCode: string,
  testCases: TestCase[],
  type: 'SAMPLE' | 'HIDDEN' = 'SAMPLE',
  timeoutMs: number = 2000
): Promise<{ allPassed: boolean; compileError: string | null; securityViolation: string | null; results: TestCaseEvaluation[] }> {
  const results: TestCaseEvaluation[] = [];
  let allPassed = true;
  let compileError: string | null = null;
  let securityViolation: string | null = null;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const execResult = await compileAndRunC(sourceCode, tc.input || '', timeoutMs);

    if (execResult.error === 'SECURITY_VIOLATION') {
      securityViolation = execResult.output;
      allPassed = false;
      results.push({
        name: `${type === 'SAMPLE' ? 'Sample' : 'Hidden'} Test Case ${i + 1}`,
        type,
        status: 'SECURITY_VIOLATION',
        timeMs: 0,
        error: execResult.output,
      });
      break;
    }

    if (execResult.error === 'COMPILATION_ERROR') {
      compileError = execResult.output;
      allPassed = false;
      break;
    }

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
  }

  return { allPassed, compileError, securityViolation, results };
}
