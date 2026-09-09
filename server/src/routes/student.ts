import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getCurrentEvent } from '../services/eventService';
import { executeCode, runCodePreview, TestCase } from '../services/executionService';

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
router.get('/current-event', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const event = await getCurrentEvent();
  if (!event) {
    res.json({ event: null });
    return;
  }

  // Check if current user is qualified for Round 2 if in Technical Quiz
  let isQualifiedForRound2 = false;
  let qualification = null;
  if (event.type === 'TECHNICAL_QUIZ') {
    qualification = await prisma.quizQualification.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: req.user!.userId } },
    });
    isQualifiedForRound2 = !!qualification?.isQualified;
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
      currentRound: event.currentRound || 1,
      round1Status: event.round1Status || 'DRAFT',
      round2Status: event.round2Status || 'DRAFT',
      round1Duration: event.round1Duration || 1800,
      round2Duration: event.round2Duration || 1200,
      qualifierCount: event.qualifierCount || 10,
      isQualifiedForRound2,
      qualification: qualification
        ? {
            isQualified: qualification.isQualified,
            round1Score: qualification.round1Score,
            round1Rank: qualification.round1Rank,
            round2Score: qualification.round2Score,
            finalScore: qualification.finalScore,
            finalRank: qualification.finalRank,
          }
        : null,
      serverTime: new Date().toISOString(),
    },
  });
});

// ─── GET /api/events/:id ─────────────────────────────────────────────────────
router.get('/events/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  let isQualifiedForRound2 = false;
  if (event.type === 'TECHNICAL_QUIZ') {
    const qual = await prisma.quizQualification.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: req.user!.userId } },
    });
    isQualifiedForRound2 = !!qual?.isQualified;
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
      currentRound: event.currentRound || 1,
      round1Status: event.round1Status || 'DRAFT',
      round2Status: event.round2Status || 'DRAFT',
      round1Duration: event.round1Duration || 1800,
      round2Duration: event.round2Duration || 1200,
      isQualifiedForRound2,
      serverTime: new Date().toISOString(),
    },
  });
});

// ─── GET /api/events/:id/quiz-challenges ────────────────────────────────────
router.get(
  '/events/:id/quiz-challenges',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
    if (!event || event.type !== 'TECHNICAL_QUIZ') {
      res.status(404).json({ error: 'Technical Quiz event not found' });
      return;
    }

    const round = Number(req.query.round) || event.currentRound || 1;

    // Fetch challenges for this round
    const challenges = await prisma.quizChallenge.findMany({
      where: { eventId: event.id, round, isActive: true },
      orderBy: { order: 'asc' },
      include: {
        _count: { select: { questions: true } },
      },
    });

    // Check student's answers/puzzle progress per challenge
    const answers = await prisma.answer.findMany({
      where: { eventId: event.id, userId: req.user!.userId, round },
      include: { question: { select: { challengeId: true } } },
    });

    const puzzleSubs = await prisma.puzzleSubmission.findMany({
      where: { eventId: event.id, userId: req.user!.userId, round },
    });

    const challengeProgress: Record<string, { answered: number; isCompleted: boolean }> = {};
    for (const c of challenges) {
      if (c.type === 'PUZZLE_GRID') {
        const pz = puzzleSubs.find((p) => p.challengeId === c.id);
        challengeProgress[c.id] = {
          answered: pz ? 1 : 0,
          isCompleted: !!pz?.isSolved,
        };
      } else {
        const count = answers.filter((a) => a.question.challengeId === c.id).length;
        const total = c._count.questions;
        challengeProgress[c.id] = {
          answered: count,
          isCompleted: total > 0 && count >= total,
        };
      }
    }

    res.json({
      round,
      challenges: challenges.map((c) => ({
        id: c.id,
        round: c.round,
        type: c.type,
        title: c.title,
        subtitle: c.subtitle,
        description: c.description,
        order: c.order,
        points: c.points,
        timeLimit: c.timeLimit,
        config: c.config ? JSON.parse(c.config) : {},
        isActive: c.isActive,
        isLocked: c.isLocked,
        questionCount: c._count.questions,
        progress: challengeProgress[c.id] || { answered: 0, isCompleted: false },
      })),
    });
  }
);

// ─── GET /api/events/:id/quiz-questions ──────────────────────────────────────
router.get(
  '/events/:id/quiz-questions',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
    if (!event || event.type !== 'TECHNICAL_QUIZ') {
      res.status(404).json({ error: 'Technical Quiz event not found' });
      return;
    }

    const round = Number(req.query.round) || event.currentRound || 1;
    const challengeId = req.query.challengeId ? String(req.query.challengeId) : undefined;

    // If student is in Round 2, ensure they are qualified
    if (round === 2) {
      const qual = await prisma.quizQualification.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: req.user!.userId } },
      });
      if (!qual || !qual.isQualified) {
        res.status(403).json({ error: 'You are not qualified for Round 2' });
        return;
      }
    }

    const questions = await prisma.quizQuestion.findMany({
      where: {
        eventId: event.id,
        round,
        ...(challengeId && { challengeId }),
      },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        challengeId: true,
        round: true,
        category: true,
        type: true,
        question: true,
        imageUrl: true,
        optionA: true,
        optionB: true,
        optionC: true,
        optionD: true,
        points: true,
        order: true,
        // Exclude correctAnswer and explanation for competitive integrity
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
    const eventId = String(req.params.id);
    const round = Number(req.query.round) || undefined;

    const answers = await prisma.answer.findMany({
      where: {
        userId: req.user!.userId,
        eventId,
        ...(round && { round }),
      },
      select: {
        questionId: true,
        selectedAnswer: true,
        isCorrect: true,
        pointsAwarded: true,
        round: true,
      },
    });

    res.json({ answers });
  }
);

// ─── GET /api/events/:id/my-puzzle ───────────────────────────────────────────
router.get(
  '/events/:id/my-puzzle',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const eventId = String(req.params.id);
    const challengeId = req.query.challengeId ? String(req.query.challengeId) : undefined;

    const puzzle = await prisma.puzzleSubmission.findFirst({
      where: {
        userId: req.user!.userId,
        eventId,
        ...(challengeId && { challengeId }),
      },
    });

    res.json({ puzzle });
  }
);

// ─── POST /api/events/:id/puzzle-submit ──────────────────────────────────────
const puzzleSubmitSchema = z.object({
  challengeId: z.string().min(1),
  moves: z.number().int().nonnegative(),
  timeTakenSeconds: z.number().int().nonnegative(),
  isSolved: z.boolean(),
  initialState: z.string().default('[]'),
});

router.post(
  '/events/:id/puzzle-submit',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = puzzleSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { challengeId, moves, timeTakenSeconds, isSolved, initialState } = parsed.data;
    const eventId = String(req.params.id);
    const userId = req.user!.userId;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.type !== 'TECHNICAL_QUIZ') {
      res.status(404).json({ error: 'Quiz event not found' });
      return;
    }
    if (event.status !== 'RUNNING') {
      res.status(409).json({ error: 'Quiz is not currently running' });
      return;
    }

    const challenge = await prisma.quizChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) {
      res.status(404).json({ error: 'Puzzle challenge not found' });
      return;
    }

    // Calculate score for puzzle
    let pointsAwarded = 0;
    if (isSolved) {
      const basePoints = challenge.points || 150;
      // Bonus for fast completion
      const speedBonus = Math.max(0, Math.floor((180 - timeTakenSeconds) / 4));
      pointsAwarded = basePoints + speedBonus;
    }

    const submission = await prisma.puzzleSubmission.upsert({
      where: { userId_challengeId: { userId, challengeId } },
      create: {
        userId,
        eventId,
        challengeId,
        round: challenge.round,
        moves,
        timeTakenSeconds,
        isSolved,
        initialState,
        pointsAwarded,
      },
      update: {
        moves,
        timeTakenSeconds,
        isSolved,
        pointsAwarded,
      },
    });

    res.json({
      submission: {
        id: submission.id,
        isSolved: submission.isSolved,
        moves: submission.moves,
        timeTakenSeconds: submission.timeTakenSeconds,
        pointsAwarded: submission.pointsAwarded,
      },
    });
  }
);

// ─── POST /api/events/:id/answers ────────────────────────────────────────────
const submitAnswerSchema = z.object({
  questionId: z.string().min(1),
  selectedAnswer: z.string().min(1),
  timeTakenSeconds: z.number().int().nonnegative().default(0),
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

    const { questionId, selectedAnswer, timeTakenSeconds } = parsed.data;
    const eventId = String(req.params.id);
    const userId = req.user!.userId;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.type !== 'TECHNICAL_QUIZ') {
      res.status(404).json({ error: 'Quiz event not found' });
      return;
    }
    if (event.status !== 'RUNNING') {
      res.status(409).json({ error: 'Quiz is not currently running' });
      return;
    }

    const question = await prisma.quizQuestion.findFirst({
      where: { id: questionId, eventId },
    });
    if (!question) {
      res.status(404).json({ error: 'Question not found in this event' });
      return;
    }

    // If Round 2, verify student is qualified
    if (question.round === 2) {
      const qual = await prisma.quizQualification.findUnique({
        where: { eventId_userId: { eventId, userId } },
      });
      if (!qual || !qual.isQualified) {
        res.status(403).json({ error: 'You are not qualified for Round 2' });
        return;
      }
    }

    // Server-side correctness check
    let isCorrect = false;
    if (question.type === 'SHUFFLE_ORDER') {
      try {
        const studentArr = JSON.parse(selectedAnswer);
        const correctArr = JSON.parse(question.correctAnswer);
        isCorrect = JSON.stringify(studentArr) === JSON.stringify(correctArr);
      } catch {
        isCorrect = selectedAnswer.trim() === question.correctAnswer.trim();
      }
    } else {
      isCorrect = question.correctAnswer.trim().toUpperCase() === selectedAnswer.trim().toUpperCase();
    }

    const pointsAwarded = isCorrect ? question.points : 0;

    const answer = await prisma.answer.upsert({
      where: { userId_questionId: { userId, questionId } },
      create: {
        userId,
        eventId,
        questionId,
        round: question.round,
        selectedAnswer,
        isCorrect,
        pointsAwarded,
        timeTakenSeconds,
      },
      update: {
        selectedAnswer,
        isCorrect,
        pointsAwarded,
        timeTakenSeconds,
      },
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

// ─── GET /api/events/:id/my-qualification ────────────────────────────────────
router.get(
  '/events/:id/my-qualification',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const eventId = String(req.params.id);
    const qual = await prisma.quizQualification.findUnique({
      where: { eventId_userId: { eventId, userId: req.user!.userId } },
    });

    res.json({ qualification: qual });
  }
);

// ─── DEBUGGING ROUTES (Kept 100% Intact) ──────────────────────────────────────
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
      },
    });

    res.json({ problems });
  }
);

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

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.type !== 'DEBUGGING') {
      res.status(404).json({ error: 'Debugging event not found' });
      return;
    }
    if (event.status !== 'RUNNING') {
      res.status(409).json({ error: 'Submissions are not accepted right now' });
      return;
    }

    const problem = await prisma.debuggingProblem.findFirst({
      where: { id: problemId, eventId },
    });
    if (!problem) {
      res.status(404).json({ error: 'Problem not found in this event' });
      return;
    }

    const storedTestCases =
      typeof problem.testCases === 'string' ? JSON.parse(problem.testCases) : problem.testCases;
    const testCases = z
      .array(z.object({ input: z.string(), expectedOutput: z.string() }))
      .parse(storedTestCases) as TestCase[];
    const execResult = await executeCode(code, testCases, problem.timeLimit);

    const pointsAwarded = execResult.result === 'ACCEPTED' ? problem.points : 0;

    const existingAccepted = await prisma.submission.findFirst({
      where: { userId, problemId, result: 'ACCEPTED' },
    });

    const submission = await prisma.submission.create({
      data: {
        userId,
        eventId,
        problemId,
        submittedCode: code,
        result: execResult.result,
        compileOutput: execResult.compileOutput,
        runOutput: execResult.runOutput,
        pointsAwarded: existingAccepted ? 0 : pointsAwarded,
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

export default router;
