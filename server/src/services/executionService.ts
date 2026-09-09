import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';

export interface TestCase {
  input: string;
  expectedOutput: string;
}

export interface TestCaseResult {
  name: string;
  type: 'SAMPLE' | 'HIDDEN';
  status: 'PASSED' | 'FAILED' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  timeMs: number;
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  error?: string;
}

export interface SandboxRunResult {
  success: boolean;
  compileOutput: string;
  runOutput: string;
  error?: string;
  testCases: TestCaseResult[];
}

export interface SandboxSubmitResult {
  result: 'ACCEPTED' | 'WRONG_ANSWER' | 'COMPILE_ERROR' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  compileOutput: string;
  runOutput: string;
  passedCases: number;
  totalCases: number;
  cheatDetected?: boolean;
  cheatReason?: string;
  testCases: TestCaseResult[];
}

const COMPILE_TIMEOUT_MS = 15000; // 15 seconds to compile
const RUN_TIMEOUT_MS = 8000;      // 8 seconds wall-clock per test case

function runProcess(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number | null; timeMs: number }> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill('SIGKILL');
        const duration = Math.round(performance.now() - startTime);
        resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', code: null, timeMs: duration });
      }
    }, timeoutMs);

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > 65536) proc.kill('SIGKILL');
    });

    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 65536) proc.kill('SIGKILL');
    });

    proc.on('close', (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        const duration = Math.round(performance.now() - startTime);
        resolve({ stdout, stderr, code, timeMs: duration });
      }
    });

    proc.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        const duration = Math.round(performance.now() - startTime);
        resolve({ stdout, stderr: err.message, code: -1, timeMs: duration });
      }
    });

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}

function normalizeOutput(s: string): string {
  if (!s) return '';
  return s
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Anti-Cheat & Hardcoded Output Detection:
 * Flags submissions that bypass logic by statically printing expected test case answers.
 */
export function detectHardcodingTricks(
  code: string,
  sampleCases: TestCase[],
  hiddenCases: TestCase[]
): { isCheat: boolean; reason?: string } {
  // Strip comments
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim();

  const allCases = [...sampleCases, ...hiddenCases];
  const requiresInput = allCases.some((c) => c.input && c.input.trim().length > 0);

  // If problem feeds stdin inputs, the code MUST use standard input functions
  if (requiresInput) {
    const inputPatterns = /\b(scanf|getchar|getc|fgets|fscanf|cin|getline|read|fread)\b/;
    if (!inputPatterns.test(stripped)) {
      return {
        isCheat: true,
        reason: 'Hardcoding Detected: Solution does not read required program inputs (e.g., missing scanf/getchar).',
      };
    }
  }

  // Check if code merely outputs static literals matching the outputs without any variable operations
  const mainBodyMatch = stripped.match(/main\s*\([^)]*\)\s*\{([\s\S]*)\}/);
  if (mainBodyMatch) {
    const mainBody = mainBodyMatch[1].trim();
    // If the body is just a single printf/puts/return statement with constant strings
    const onlyPrintMatch = mainBody.match(/^(?:printf|puts)\s*\(\s*["']([^"']+)["']\s*\)\s*;\s*(?:return\s+0\s*;)?$/);
    if (onlyPrintMatch && allCases.length > 1) {
      const distinctOutputs = new Set(allCases.map((c) => normalizeOutput(c.expectedOutput)));
      if (distinctOutputs.size > 1) {
        return {
          isCheat: true,
          reason: 'Hardcoding Detected: Static literal print detected instead of calculating dynamic output.',
        };
      }
    }
  }

  return { isCheat: false };
}

/**
 * Execute code strictly against SAMPLE test cases (for "Run Code" / "Run Sample").
 */
export async function executeSampleTestCases(
  code: string,
  sampleCases: TestCase[],
  timeLimitSec: number = 5
): Promise<SandboxRunResult> {
  const execDir = join(tmpdir(), `sasi-sample-${randomUUID()}`);
  mkdirSync(execDir, { recursive: true });

  const srcFile = join(execDir, 'main.c');
  const binFile = join(execDir, 'main');

  try {
    writeFileSync(srcFile, code, 'utf-8');

    // Compile
    const compile = await runProcess(
      'gcc',
      ['-o', binFile, srcFile, '-lm', '-Wall', '-w'],
      '',
      COMPILE_TIMEOUT_MS,
      execDir
    );

    if (compile.code !== 0) {
      return {
        success: false,
        compileOutput: compile.stderr || compile.stdout || 'Compilation failed',
        runOutput: '',
        error: compile.stderr || 'Compilation error',
        testCases: [],
      };
    }

    // Default sample case if empty
    const casesToRun = sampleCases.length > 0 ? sampleCases : [{ input: '', expectedOutput: '' }];
    const testResults: TestCaseResult[] = [];
    let allPassed = true;
    let mainOutput = '';

    for (let i = 0; i < casesToRun.length; i++) {
      const tc = casesToRun[i];
      const run = await runProcess(
        binFile,
        [],
        tc.input || '',
        Math.min(timeLimitSec * 1000, RUN_TIMEOUT_MS),
        execDir
      );

      const actual = normalizeOutput(run.stdout);
      const expected = normalizeOutput(tc.expectedOutput);
      const isTimeout = run.stderr.includes('[TIMEOUT]') || run.code === null;
      const isRuntimeError = run.code !== 0 && !isTimeout;
      const isPassed = !isTimeout && !isRuntimeError && (expected === '' || actual === expected);

      if (!isPassed) allPassed = false;
      if (i === 0) mainOutput = run.stdout;

      testResults.push({
        name: `Sample Test Case ${i + 1}`,
        type: 'SAMPLE',
        status: isTimeout
          ? 'TIME_LIMIT_EXCEEDED'
          : isRuntimeError
          ? 'RUNTIME_ERROR'
          : isPassed
          ? 'PASSED'
          : 'FAILED',
        timeMs: run.timeMs,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        actualOutput: run.stdout,
        error: run.stderr || undefined,
      });
    }

    return {
      success: allPassed,
      compileOutput: compile.stdout,
      runOutput: mainOutput,
      testCases: testResults,
    };
  } finally {
    try {
      rmSync(execDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

/**
 * Execute code against BOTH sample AND hidden test cases (for "Submit Solution").
 */
export async function executeSubmissionEvaluation(
  code: string,
  sampleCases: TestCase[],
  hiddenCases: TestCase[],
  timeLimitSec: number = 5
): Promise<SandboxSubmitResult> {
  // Anti-Cheat Check
  const antiCheat = detectHardcodingTricks(code, sampleCases, hiddenCases);
  if (antiCheat.isCheat) {
    return {
      result: 'WRONG_ANSWER',
      compileOutput: '',
      runOutput: `⚠️ Validation Flag: ${antiCheat.reason}`,
      passedCases: 0,
      totalCases: sampleCases.length + hiddenCases.length,
      cheatDetected: true,
      cheatReason: antiCheat.reason,
      testCases: [
        {
          name: 'Anti-Cheat Validation',
          type: 'HIDDEN',
          status: 'FAILED',
          timeMs: 0,
          error: antiCheat.reason,
        },
      ],
    };
  }

  const execDir = join(tmpdir(), `sasi-submit-${randomUUID()}`);
  mkdirSync(execDir, { recursive: true });

  const srcFile = join(execDir, 'main.c');
  const binFile = join(execDir, 'main');

  try {
    writeFileSync(srcFile, code, 'utf-8');

    // Compile
    const compile = await runProcess(
      'gcc',
      ['-o', binFile, srcFile, '-lm', '-Wall', '-w'],
      '',
      COMPILE_TIMEOUT_MS,
      execDir
    );

    if (compile.code !== 0) {
      return {
        result: 'COMPILE_ERROR',
        compileOutput: compile.stderr || compile.stdout || 'Compilation failed',
        runOutput: '',
        passedCases: 0,
        totalCases: sampleCases.length + hiddenCases.length,
        testCases: [],
      };
    }

    const testResults: TestCaseResult[] = [];
    let passedCases = 0;
    let worstResult: 'ACCEPTED' | 'WRONG_ANSWER' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR' = 'ACCEPTED';
    let summaryRunOutput = '';

    // ── 1. Evaluate Sample Test Cases ─────────────────────────────────────────
    for (let i = 0; i < sampleCases.length; i++) {
      const tc = sampleCases[i];
      const run = await runProcess(
        binFile,
        [],
        tc.input || '',
        Math.min(timeLimitSec * 1000, RUN_TIMEOUT_MS),
        execDir
      );

      const actual = normalizeOutput(run.stdout);
      const expected = normalizeOutput(tc.expectedOutput);
      const isTimeout = run.stderr.includes('[TIMEOUT]') || run.code === null;
      const isRuntimeError = run.code !== 0 && !isTimeout;
      const isPassed = !isTimeout && !isRuntimeError && actual === expected;

      if (isPassed) {
        passedCases++;
      } else {
        if (worstResult === 'ACCEPTED') {
          worstResult = isTimeout ? 'TIME_LIMIT_EXCEEDED' : isRuntimeError ? 'RUNTIME_ERROR' : 'WRONG_ANSWER';
        }
        if (!summaryRunOutput) {
          summaryRunOutput = isTimeout
            ? 'Execution timed out (5.0s Limit)'
            : isRuntimeError
            ? run.stderr || 'Runtime error'
            : `Sample Case ${i + 1} Failed — Expected: "${expected}", Got: "${actual}"`;
        }
      }

      testResults.push({
        name: `Sample Test Case ${i + 1}`,
        type: 'SAMPLE',
        status: isTimeout
          ? 'TIME_LIMIT_EXCEEDED'
          : isRuntimeError
          ? 'RUNTIME_ERROR'
          : isPassed
          ? 'PASSED'
          : 'FAILED',
        timeMs: run.timeMs,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        actualOutput: run.stdout,
        error: run.stderr || undefined,
      });
    }

    // ── 2. Evaluate Hidden Test Cases ─────────────────────────────────────────
    for (let i = 0; i < hiddenCases.length; i++) {
      const tc = hiddenCases[i];
      const run = await runProcess(
        binFile,
        [],
        tc.input || '',
        Math.min(timeLimitSec * 1000, RUN_TIMEOUT_MS),
        execDir
      );

      const actual = normalizeOutput(run.stdout);
      const expected = normalizeOutput(tc.expectedOutput);
      const isTimeout = run.stderr.includes('[TIMEOUT]') || run.code === null;
      const isRuntimeError = run.code !== 0 && !isTimeout;
      const isPassed = !isTimeout && !isRuntimeError && actual === expected;

      if (isPassed) {
        passedCases++;
      } else {
        if (worstResult === 'ACCEPTED') {
          worstResult = isTimeout ? 'TIME_LIMIT_EXCEEDED' : isRuntimeError ? 'RUNTIME_ERROR' : 'WRONG_ANSWER';
        }
        if (!summaryRunOutput) {
          summaryRunOutput = `Hidden Test Case ${i + 1} Failed`;
        }
      }

      // DO NOT reveal hidden inputs/outputs in payload!
      testResults.push({
        name: `Hidden Test Case ${i + 1}`,
        type: 'HIDDEN',
        status: isTimeout
          ? 'TIME_LIMIT_EXCEEDED'
          : isRuntimeError
          ? 'RUNTIME_ERROR'
          : isPassed
          ? 'PASSED'
          : 'FAILED',
        timeMs: run.timeMs,
      });
    }

    const totalCases = sampleCases.length + hiddenCases.length;
    const finalResult = passedCases === totalCases ? 'ACCEPTED' : worstResult;

    return {
      result: finalResult,
      compileOutput: compile.stdout,
      runOutput: summaryRunOutput || (finalResult === 'ACCEPTED' ? 'All test cases passed successfully!' : ''),
      passedCases,
      totalCases,
      testCases: testResults,
    };
  } finally {
    try {
      rmSync(execDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

// ── Backward-compatible exports ─────────────────────────────────────────────
export async function executeCode(
  code: string,
  testCases: TestCase[],
  timeLimitSec: number
) {
  return executeSubmissionEvaluation(code, testCases, [], timeLimitSec);
}

export async function runCodePreview(code: string, input: string = '') {
  const result = await executeSampleTestCases(code, [{ input, expectedOutput: '' }]);
  return {
    success: result.success,
    output: result.runOutput,
    error: result.error || '',
    testCases: result.testCases,
  };
}

