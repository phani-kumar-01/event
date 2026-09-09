import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getCurrentEvent } from '../services/eventService';
import { executeCode, runCodePreview, TestCase } from '../services/executionService';
import { Server } from 'socket.io';

const router = Router();

// ─── GET /api/me ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, rollNo: true, name: true, role: true },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user });
});

// ─── GET /api/current-event ──────────────────────────────────────────────────
router.get('/current-event', requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  const event = await getCurrentEvent();
  res.json({
    event: event
      ? {
          id: event.id,
          type: event.type,
          name: event.name,
          status: event.status,
          startTime: event.startTime.toISOString(),
          endTime: event.endTime.toISOString(),
          version: event.version,
          serverTime: new Date().toISOString(),
        }
      : null,
  });
});

// ─── GET /api/events/:id ─────────────────────────────────────────────────────
router.get('/events/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  res.json({
    event: {
      id: event.id,
      type: event.type,
      name: event.name,
      status: event.status,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
      version: event.version,
      serverTime: new Date().toISOString(),
    },
  });
});

// ─── GET /api/events/:id/debugging-problems ──────────────────────────────────
router.get(
  '/events/:id/debugging-problems',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    if (event.type !== 'DEBUGGING') {
      res.status(400).json({ error: 'This event is not a debugging competition' });
      return;
    }

    const problems = await prisma.debuggingProblem.findMany({
      where: { eventId: String(req.params.id) },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        buggyCode: true,
        expectedOutput: true,
        points: true,
        timeLimit: true,
        order: true,
        // Exclude testCases from student view (backend-only)
      },
    });

    res.json({ problems });
  }
);

// ─── GET /api/events/:id/quiz-questions ──────────────────────────────────────
router.get(
  '/events/:id/quiz-questions',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    if (event.type !== 'TECHNICAL_QUIZ') {
      res.status(400).json({ error: 'This event is not a quiz competition' });
      return;
    }

    const questions = await prisma.quizQuestion.findMany({
      where: { eventId: String(req.params.id) },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        question: true,
        optionA: true,
        optionB: true,
        optionC: true,
        optionD: true,
        points: true,
        order: true,
        // Exclude correctAnswer and explanation from student view
      },
    });

    res.json({ questions });
  }
);

// ─── GET /api/events/:id/my-answers ──────────────────────────────────────────
router.get(
  '/events/:id/my-answers',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const answers = await prisma.answer.findMany({
      where: { userId: req.user!.userId, eventId: String(req.params.id) },
    });
    res.json({ answers });
  }
);

// ─── GET /api/events/:id/my-submissions ──────────────────────────────────────
router.get(
  '/events/:id/my-submissions',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const submissions = await prisma.submission.findMany({
      where: { userId: req.user!.userId, eventId: String(req.params.id) },
      orderBy: { submittedAt: 'desc' },
    });
    res.json({ submissions });
  }
);

// ─── POST /api/events/:id/run-code ───────────────────────────────────────────
router.post(
  '/events/:id/run-code',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
    if (!event || event.type !== 'DEBUGGING') {
      res.status(404).json({ error: 'Debugging event not found' });
      return;
    }
    if (event.status !== 'RUNNING') {
      res.status(409).json({ error: 'Event is not currently running' });
      return;
    }

    const { code, input } = req.body as { code: string; input?: string };
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Code is required' });
      return;
    }

    const result = await runCodePreview(code, input || '');
    res.json(result);
  }
);

// ─── POST /api/events/:id/submit-code ────────────────────────────────────────
const submitCodeSchema = z.object({
  problemId: z.string().min(1),
  code: z.string().min(1, 'Code cannot be empty'),
});

router.post(
  '/events/:id/submit-code',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = submitCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { problemId, code } = parsed.data;
    const eventId = String(req.params.id);
    const userId = req.user!.userId;

    // Validate event
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.type !== 'DEBUGGING') {
      res.status(404).json({ error: 'Debugging event not found' });
      return;
    }
    if (event.status !== 'RUNNING') {
      res.status(409).json({ error: 'Submissions are not accepted right now' });
      return;
    }

    // Validate problem belongs to event
    const problem = await prisma.debuggingProblem.findFirst({
      where: { id: problemId, eventId },
    });
    if (!problem) {
      res.status(404).json({ error: 'Problem not found in this event' });
      return;
    }

    // Execute code against test cases
    const storedTestCases = typeof problem.testCases === 'string'
      ? JSON.parse(problem.testCases)
      : problem.testCases;
    const testCases = z.array(z.object({ input: z.string(), expectedOutput: z.string() }))
      .parse(storedTestCases) as TestCase[];
    const execResult = await executeCode(code, testCases, problem.timeLimit);

    // Calculate points — full points for ACCEPTED, 0 otherwise
    const pointsAwarded = execResult.result === 'ACCEPTED' ? problem.points : 0;

    // Check if student already has an ACCEPTED submission for this problem
    const existingAccepted = await prisma.submission.findFirst({
      where: { userId, problemId, result: 'ACCEPTED' },
    });

    // Store submission (always, so student can see history)
    const submission = await prisma.submission.create({
      data: {
        userId,
        eventId,
        problemId,
        submittedCode: code,
        result: execResult.result,
        compileOutput: execResult.compileOutput,
        runOutput: execResult.runOutput,
        pointsAwarded: existingAccepted ? 0 : pointsAwarded, // no double points
      },
    });

    res.json({
      submission: {
        id: submission.id,
        result: submission.result,
        compileOutput: submission.compileOutput,
        runOutput: submission.runOutput,
        pointsAwarded: submission.pointsAwarded,
        passedCases: execResult.passedCases,
        totalCases: execResult.totalCases,
        submittedAt: submission.submittedAt.toISOString(),
      },
    });
  }
);

// ─── POST /api/events/:id/answers ────────────────────────────────────────────
const submitAnswerSchema = z.object({
  questionId: z.string().min(1),
  selectedAnswer: z.enum(['A', 'B', 'C', 'D']),
});

router.post(
  '/events/:id/answers',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = submitAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { questionId, selectedAnswer } = parsed.data;
    const eventId = String(req.params.id);
    const userId = req.user!.userId;

    // Validate event
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.type !== 'TECHNICAL_QUIZ') {
      res.status(404).json({ error: 'Quiz event not found' });
      return;
    }
    if (event.status !== 'RUNNING') {
      res.status(409).json({ error: 'Quiz is not currently running' });
      return;
    }

    // Validate question belongs to event
    const question = await prisma.quizQuestion.findFirst({
      where: { id: questionId, eventId },
    });
    if (!question) {
      res.status(404).json({ error: 'Question not found in this event' });
      return;
    }

    // Server-side correctness check
    const isCorrect = question.correctAnswer === selectedAnswer;
    const pointsAwarded = isCorrect ? question.points : 0;

    // Upsert answer (student can change answer while event is running)
    const answer = await prisma.answer.upsert({
      where: { userId_questionId: { userId, questionId } },
      create: { userId, eventId, questionId, selectedAnswer, isCorrect, pointsAwarded },
      update: { selectedAnswer, isCorrect, pointsAwarded },
    });

    res.json({
      answer: {
        id: answer.id,
        questionId: answer.questionId,
        selectedAnswer: answer.selectedAnswer,
        isCorrect: answer.isCorrect,
        pointsAwarded: answer.pointsAwarded,
        explanation: question.explanation,
      },
    });
  }
);

export default router;
