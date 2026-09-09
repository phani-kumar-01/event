import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { evaluateCWithTestCases, TestCase, TestCaseEvaluation } from '../services/cRunner';
import { detectHardcodingTricks } from '../services/executionService';

const executeSchema = z.object({
  problemId: z.string().min(1),
  sourceCode: z.string().min(1, 'Source code cannot be empty'),
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
 * POST /api/debugging/execute
 * Handles both "RUN" (sample only) and "SUBMIT" (sample + hidden + persistence + sockets)
 */
export async function executeDebuggingCode(req: AuthRequest, res: Response): Promise<void> {
  const parsed = executeSchema.safeParse({
    problemId: req.body.problemId,
    sourceCode: req.body.sourceCode || req.body.code,
    mode: req.body.mode || 'RUN',
  });

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { problemId, sourceCode, mode } = parsed.data;
  const userId = req.user!.userId;

  const problem = await prisma.debuggingProblem.findUnique({
    where: { id: problemId },
    include: { event: true },
  });

  if (!problem) {
    res.status(404).json({ error: 'Debugging problem not found' });
    return;
  }

  const event = problem.event;
  if (event.status !== 'RUNNING' && req.user?.role !== 'ADMIN') {
    res.status(409).json({ error: 'Debugging event is not currently active' });
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
        error: 'Compilation Error',
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
    });
    return;
  }

  // ── 2. MODE: SUBMIT (Sample + Hidden test cases with Scoring & Sockets) ────
  // Anti-cheat verification
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

    res.json({
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

    res.json({
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

    res.json({
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
  if (!isAccepted) {
    const hasTLE = allTestResults.some((t) => t.status === 'TIME_LIMIT_EXCEEDED');
    const hasRuntime = allTestResults.some((t) => t.status === 'RUNTIME_ERROR' || t.status === 'SECURITY_VIOLATION');
    worstVerdict = hasTLE ? 'TIME_LIMIT_EXCEEDED' : hasRuntime ? 'RUNTIME_ERROR' : 'WRONG_ANSWER';
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

    // Emit Socket.IO events for live unlock & leaderboard updates
    const io = req.app.get('io');
    if (io) {
      const payload = {
        userId,
        eventId: event.id,
        problemId: problem.id,
        nextProblemId: nextProblem?.id,
        pointsAwarded: submission.pointsAwarded,
      };

      // Both event names for complete compatibility
      io.to(`event:${event.id}`).emit('PROBLEM_SOLVED', payload);
      io.to(`event:${event.id}`).emit('debugging:problem_solved', payload);
      io.emit('PROBLEM_SOLVED', payload);
      io.emit('debugging:problem_solved', payload);
    }
  }

  res.json({
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
}
