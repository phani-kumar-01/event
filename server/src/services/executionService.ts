import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export interface TestCase {
  input: string;
  expectedOutput: string;
}

export interface ExecutionResult {
  result: 'ACCEPTED' | 'WRONG_ANSWER' | 'COMPILE_ERROR' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  compileOutput: string;
  runOutput: string;
  passedCases: number;
  totalCases: number;
}

const COMPILE_TIMEOUT_MS = 15000; // 15 seconds to compile
const RUN_TIMEOUT_MS = 10000;     // 10 seconds wall-clock per test case

function runProcess(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
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
        resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', code: null });
      }
    }, timeoutMs);

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      // Safety: limit output size
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
        resolve({ stdout, stderr, code });
      }
    });

    proc.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, code: -1 });
      }
    });

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}

function normalizeOutput(s: string): string {
  // Trim trailing whitespace from each line and normalize newlines
  return s
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

export async function executeCode(
  code: string,
  testCases: TestCase[],
  timeLimitSec: number
): Promise<ExecutionResult> {
  // Create isolated temp directory
  const execDir = join(tmpdir(), `sasi-exec-${randomUUID()}`);
  mkdirSync(execDir, { recursive: true });

  const srcFile = join(execDir, 'main.c');
  const binFile = join(execDir, 'main');

  try {
    writeFileSync(srcFile, code, 'utf-8');

    // ── Step 1: Compile ──────────────────────────────────────────────
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
        compileOutput: compile.stderr || compile.stdout,
        runOutput: '',
        passedCases: 0,
        totalCases: testCases.length,
      };
    }

    // ── Step 2: Run against each test case ───────────────────────────
    let passedCases = 0;
    let lastRunOutput = '';

    for (const tc of testCases) {
      const run = await runProcess(
        binFile,
        [],
        tc.input,
        Math.min(timeLimitSec * 1000, RUN_TIMEOUT_MS),
        execDir
      );

      lastRunOutput = run.stdout;

      if (run.stderr.includes('[TIMEOUT]') || run.code === null) {
        return {
          result: 'TIME_LIMIT_EXCEEDED',
          compileOutput: '',
          runOutput: lastRunOutput,
          passedCases,
          totalCases: testCases.length,
        };
      }

      if (run.code !== 0) {
        return {
          result: 'RUNTIME_ERROR',
          compileOutput: '',
          runOutput: run.stderr || lastRunOutput,
          passedCases,
          totalCases: testCases.length,
        };
      }

      const actual = normalizeOutput(run.stdout);
      const expected = normalizeOutput(tc.expectedOutput);

      if (actual === expected) {
        passedCases++;
      } else {
        return {
          result: 'WRONG_ANSWER',
          compileOutput: '',
          runOutput: `Expected:\n${expected}\n\nGot:\n${actual}`,
          passedCases,
          totalCases: testCases.length,
        };
      }
    }

    return {
      result: 'ACCEPTED',
      compileOutput: '',
      runOutput: lastRunOutput,
      passedCases,
      totalCases: testCases.length,
    };
  } finally {
    // Always clean up temp directory
    try {
      rmSync(execDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run code for preview (no test case evaluation) — used by "Run Code" button.
 * Returns stdout/stderr from a single run with no input.
 */
export async function runCodePreview(
  code: string,
  input: string = ''
): Promise<{ success: boolean; output: string; error: string }> {
  const execDir = join(tmpdir(), `sasi-run-${randomUUID()}`);
  mkdirSync(execDir, { recursive: true });

  const srcFile = join(execDir, 'main.c');
  const binFile = join(execDir, 'main');

  try {
    writeFileSync(srcFile, code, 'utf-8');

    const compile = await runProcess('gcc', ['-o', binFile, srcFile, '-lm', '-w'], '', COMPILE_TIMEOUT_MS, execDir);
    if (compile.code !== 0) {
      return { success: false, output: '', error: compile.stderr || 'Compilation failed' };
    }

    const run = await runProcess(binFile, [], input, RUN_TIMEOUT_MS, execDir);
    if (run.code === null) {
      return { success: false, output: run.stdout, error: 'Time limit exceeded' };
    }
    if (run.code !== 0) {
      return { success: false, output: run.stdout, error: run.stderr || 'Runtime error' };
    }

    return { success: true, output: run.stdout, error: '' };
  } finally {
    try {
      rmSync(execDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}
