import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { evaluateCWithTestCases, TestCase, TestCaseEvaluation, normalizeOutput } from '../services/cRunner';
import { detectHardcodingTricks } from '../services/executionService';

const executeSchema = z.object({
  problemId: z.union([z.string(), z.number()]),
  sourceCode: z.string().optional(),
  code: z.string().optional(),
  userId: z.string().optional(),
  mode: z.enum(['RUN', 'SUBMIT']).default('RUN'),
});

/**
 * Extract parsed test cases from problem fields
 */
function parseProblemTestCases(problem: {
  sampleTestCases: string;
  hiddenTestCases: string;
  testCases: string;
  expectedOutput: string;
}): { sampleCases: TestCase[]; hiddenCases: TestCase[] } {
  let sampleCases: TestCase[] = [];
  let hiddenCases: TestCase[] = [];

  // Parse sample cases
  try {
    const parsed = typeof problem.sampleTestCases === 'string' ? JSON.parse(problem.sampleTestCases) : problem.sampleTestCases;
    if (Array.isArray(parsed) && parsed.length > 0) {
      sampleCases = parsed;
    }
  } catch {}

  // Parse hidden cases
  try {
    const parsed = typeof problem.hiddenTestCases === 'string' ? JSON.parse(problem.hiddenTestCases) : problem.hiddenTestCases;
    if (Array.isArray(parsed) && parsed.length > 0) {
      hiddenCases = parsed;
    }
  } catch {}

  // Fallback to legacy testCases or expectedOutput if empty
  if (sampleCases.length === 0 && hiddenCases.length === 0) {
    try {
      const parsed = typeof problem.testCases === 'string' ? JSON.parse(problem.testCases) : problem.testCases;
      if (Array.isArray(parsed) && parsed.length > 0) {
        sampleCases = [parsed[0]];
        if (parsed.length > 1) {
          hiddenCases = parsed.slice(1);
        }
      }
    } catch {}
  }

  if (sampleCases.length === 0) {
    sampleCases = [{ input: '', expectedOutput: problem.expectedOutput || '' }];
  }

  return { sampleCases, hiddenCases };
}

/**
 * Find problem by string ID or numeric order
 */
async function findProblem(problemId: string | number) {
  const idStr = String(problemId);
  let problem = await prisma.debuggingProblem.findUnique({
    where: { id: idStr },
    include: { event: true },
  });

  if (!problem && !isNaN(Number(problemId))) {
    problem = await prisma.debuggingProblem.findFirst({
      where: { order: Number(problemId) },
      include: { event: true },
    });
  }

  return problem;
}

/**
 * POST /api/debugging/execute
 * Handles both "RUN" (sample only) and "SUBMIT" (sample + hidden + persistence + sockets)
 */
export async function executeDebuggingCode(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = executeSchema.safeParse({
      problemId: req.body.problemId,
      sourceCode: req.body.sourceCode || req.body.code,
      code: req.body.code || req.body.sourceCode,
      userId: req.body.userId,
      mode: req.body.mode || 'RUN',
    });

    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { problemId, mode } = parsed.data;
    const sourceCode = parsed.data.sourceCode || parsed.data.code || '';
    if (!sourceCode.trim()) {
      res.status(400).json({ success: false, error: 'Source code cannot be empty.' });
      return;
    }

    const userId = req.user?.userId || req.body.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'User authentication required.' });
      return;
    }

    const problem = await findProblem(problemId);
    if (!problem) {
      res.status(404).json({ success: false, error: 'Problem record not found in database.' });
      return;
    }

    const event = problem.event;
    if (event.status !== 'RUNNING' && req.user?.role !== 'ADMIN') {
      res.status(409).json({ success: false, error: 'Debugging event is not currently active.' });
      return;
    }

    const { sampleCases, hiddenCases } = parseProblemTestCases(problem);
    const timeoutMs = (problem.timeLimit || 2) * 1000;

    // ── 1. MODE: RUN (Sample test cases only) ──────────────────────────────────
    if (mode === 'RUN') {
      const evalResult = await evaluateCWithTestCases(sourceCode, sampleCases, 'SAMPLE', Math.min(timeoutMs, 4000));

      if (evalResult.securityViolation) {
        res.json({
          success: false,
          result: 'SECURITY_VIOLATION',
          error: evalResult.securityViolation,
          output: evalResult.securityViolation,
          testCases: evalResult.results,
          timeMs: 0,
        });
        return;
      }

      if (evalResult.compileError) {
        res.json({
          success: false,
          result: 'COMPILE_ERROR',
          compileOutput: evalResult.compileError,
          output: evalResult.compileError,
          error: `Compilation Error: ${evalResult.compileError}`,
          testCases: [],
          timeMs: 0,
        });
        return;
      }

      const firstOutput = evalResult.results[0]?.actualOutput || '';
      const totalTimeMs = evalResult.results.reduce((acc, curr) => acc + curr.timeMs, 0);

      res.json({
        success: evalResult.allPassed,
        result: evalResult.allPassed ? 'PASSED' : 'FAILED',
        output: firstOutput,
        compileOutput: '',
        testCases: evalResult.results,
        timeMs: totalTimeMs,
        expected: sampleCases[0]?.expectedOutput || problem.expectedOutput,
      });
      return;
    }

    // ── 2. MODE: SUBMIT (Sample + Hidden test cases with Scoring & Sockets) ────
    const antiCheat = detectHardcodingTricks(sourceCode, sampleCases, hiddenCases);
    if (antiCheat.isCheat) {
      const totalCases = sampleCases.length + hiddenCases.length;
      const submission = await prisma.submission.create({
        data: {
          userId,
          eventId: event.id,
          problemId: problem.id,
          submittedCode: sourceCode,
          result: 'WRONG_ANSWER',
          compileOutput: '',
          runOutput: `Validation Flag: ${antiCheat.reason}`,
          pointsAwarded: 0,
        },
      });

      res.status(400).json({
        success: false,
        error: `Submission Flagged: ${antiCheat.reason}`,
        submission: {
          id: submission.id,
          result: 'WRONG_ANSWER',
          compileOutput: '',
          runOutput: `Validation Flag: ${antiCheat.reason}`,
          pointsAwarded: 0,
          passedCases: 0,
          totalCases,
          testCases: [
            {
              name: 'Anti-Cheat Validation',
              type: 'HIDDEN',
              status: 'FAILED',
              timeMs: 0,
              error: antiCheat.reason,
            },
          ],
          submittedAt: submission.submittedAt.toISOString(),
        },
      });
      return;
    }

    // Evaluate Sample Cases
    const sampleEval = await evaluateCWithTestCases(sourceCode, sampleCases, 'SAMPLE', timeoutMs);

    if (sampleEval.securityViolation) {
      const submission = await prisma.submission.create({
        data: {
          userId,
          eventId: event.id,
          problemId: problem.id,
          submittedCode: sourceCode,
          result: 'RUNTIME_ERROR',
          compileOutput: '',
          runOutput: sampleEval.securityViolation,
          pointsAwarded: 0,
        },
      });

      res.status(400).json({
        success: false,
        error: `Security Violation: ${sampleEval.securityViolation}`,
        submission: {
          id: submission.id,
          result: 'RUNTIME_ERROR',
          compileOutput: '',
          runOutput: sampleEval.securityViolation,
          pointsAwarded: 0,
          passedCases: 0,
          totalCases: sampleCases.length + hiddenCases.length,
          testCases: sampleEval.results,
          submittedAt: submission.submittedAt.toISOString(),
        },
      });
      return;
    }

    if (sampleEval.compileError) {
      const submission = await prisma.submission.create({
        data: {
          userId,
          eventId: event.id,
          problemId: problem.id,
          submittedCode: sourceCode,
          result: 'COMPILE_ERROR',
          compileOutput: sampleEval.compileError,
          runOutput: '',
          pointsAwarded: 0,
        },
      });

      res.status(400).json({
        success: false,
        error: `Compilation Error: ${sampleEval.compileError}`,
        submission: {
          id: submission.id,
          result: 'COMPILE_ERROR',
          compileOutput: sampleEval.compileError,
          runOutput: '',
          pointsAwarded: 0,
          passedCases: 0,
          totalCases: sampleCases.length + hiddenCases.length,
          testCases: [],
          submittedAt: submission.submittedAt.toISOString(),
        },
      });
      return;
    }

    // Evaluate Hidden Cases
    let hiddenEval: { allPassed: boolean; compileError: string | null; securityViolation: string | null; results: TestCaseEvaluation[] } = {
      allPassed: true,
      compileError: null,
      securityViolation: null,
      results: [],
    };

    if (hiddenCases.length > 0) {
      hiddenEval = await evaluateCWithTestCases(sourceCode, hiddenCases, 'HIDDEN', timeoutMs);
    }

    const allTestResults = [...sampleEval.results, ...hiddenEval.results];
    const passedCases = allTestResults.filter((t) => t.status === 'PASSED').length;
    const totalCases = allTestResults.length;
    const isAccepted = passedCases === totalCases && totalCases > 0;

    let worstVerdict: 'ACCEPTED' | 'WRONG_ANSWER' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR' = 'ACCEPTED';
    let errorMessage = '';

    if (!isAccepted) {
      const hasTLE = allTestResults.some((t) => t.status === 'TIME_LIMIT_EXCEEDED');
      const hasRuntime = allTestResults.some(
        (t) => t.status === 'RUNTIME_ERROR' || t.status === 'SECURITY_VIOLATION' || t.status === 'OUTPUT_LIMIT_EXCEEDED'
      );
      worstVerdict = hasTLE ? 'TIME_LIMIT_EXCEEDED' : hasRuntime ? 'RUNTIME_ERROR' : 'WRONG_ANSWER';

      const firstFailed = allTestResults.find((t) => t.status !== 'PASSED');
      if (firstFailed) {
        if (firstFailed.status === 'TIME_LIMIT_EXCEEDED') {
          errorMessage = 'Execution timed out (2.0s Sandbox Limit). Check for infinite loops.';
        } else if (firstFailed.status === 'OUTPUT_LIMIT_EXCEEDED') {
          errorMessage = 'Output limit exceeded (10KB Max).';
        } else if (firstFailed.expectedOutput !== undefined && firstFailed.actualOutput !== undefined) {
          errorMessage = `Output Mismatch: Expected "${firstFailed.expectedOutput}", Got "${normalizeOutput(firstFailed.actualOutput)}"`;
        } else {
          errorMessage = firstFailed.error || `Test case failed (${passedCases}/${totalCases} passed)`;
        }
      }
    }

    const existingAccepted = await prisma.submission.findFirst({
      where: { userId, problemId: problem.id, result: 'ACCEPTED' },
    });

    const pointsAwarded = isAccepted && !existingAccepted ? problem.points : 0;

    const submission = await prisma.submission.create({
      data: {
        userId,
        eventId: event.id,
        problemId: problem.id,
        submittedCode: sourceCode,
        result: isAccepted ? 'ACCEPTED' : worstVerdict,
        compileOutput: '',
        runOutput: isAccepted ? 'All test cases passed successfully!' : `${passedCases}/${totalCases} test cases passed`,
        pointsAwarded,
      },
    });

    let nextProblem = null;
    if (isAccepted) {
      nextProblem = await prisma.debuggingProblem.findFirst({
        where: { eventId: event.id, order: { gt: problem.order } },
        orderBy: { order: 'asc' },
      });

      // Emit Socket.IO events for live leaderboard & instant unlock
      const io = req.app.get('io');
      if (io) {
        const payload = {
          userId,
          eventId: event.id,
          problemId: problem.id,
          nextProblemId: nextProblem?.id,
          nextProblemOrder: nextProblem?.order,
          pointsAwarded: submission.pointsAwarded,
        };

        io.to(`event:${event.id}`).emit('PROBLEM_SOLVED', payload);
        io.to(`event:${event.id}`).emit('debugging:problem_solved', payload);
        io.to(`event:${event.id}`).emit('LEADERBOARD_UPDATE', payload);
        io.emit('PROBLEM_SOLVED', payload);
        io.emit('debugging:problem_solved', payload);
        io.emit('LEADERBOARD_UPDATE', payload);
      }
    }

    if (!isAccepted) {
      res.status(400).json({
        success: false,
        error: errorMessage || 'Output mismatch or execution error.',
        submission: {
          id: submission.id,
          result: submission.result,
          compileOutput: submission.compileOutput,
          runOutput: submission.runOutput,
          pointsAwarded: submission.pointsAwarded,
          passedCases,
          totalCases,
          testCases: allTestResults,
          submittedAt: submission.submittedAt.toISOString(),
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Solution accepted!',
      nextProblemId: nextProblem?.id,
      nextProblemOrder: nextProblem?.order,
      submission: {
        id: submission.id,
        result: submission.result,
        compileOutput: submission.compileOutput,
        runOutput: submission.runOutput,
        pointsAwarded: submission.pointsAwarded,
        passedCases,
        totalCases,
        testCases: allTestResults,
        nextProblemId: nextProblem?.id,
        submittedAt: submission.submittedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Debugging Submission Error:', error);
    res.status(500).json({
      success: false,
      error: `Server internal execution error: ${(error as Error).message}`,
    });
  }
}

/**
 * POST /api/debugging/submit
 */
export async function submitDebuggingSolution(req: AuthRequest, res: Response): Promise<void> {
  req.body.mode = 'SUBMIT';
  return executeDebuggingCode(req, res);
}
