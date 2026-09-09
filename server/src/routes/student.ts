import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  getCurrentEvent,
  getOrderedQuestionsForStudent,
  validateStudentAnswer,
  generateSeededPuzzleBoard,
} from '../services/eventService';
import {
  executeSampleTestCases,
  executeSubmissionEvaluation,
  runCodePreview,
  TestCase,
} from '../services/executionService';

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
  let hasQualifications = false;
  let isLocked = false;
  let lockReason: string | undefined = undefined;

  if (event.type === 'TECHNICAL_QUIZ') {
    const qualCount = await prisma.quizQualification.count({
      where: { eventId: event.id },
    });
    hasQualifications = qualCount > 0;

    qualification = await prisma.quizQualification.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: req.user!.userId } },
    });
    isQualifiedForRound2 = !!qualification?.isQualified;

    // Once round1Status is FINISHED and qualify-round1 has run:
    // users where isQualified is false or missing get locked: true, reason: "not_qualified"
    if (event.round1Status === 'FINISHED' && hasQualifications && !isQualifiedForRound2) {
      isLocked = true;
      lockReason = 'not_qualified';
    }
  }

  const eventPayload = {
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
    locked: isLocked,
    reason: lockReason,
    hasQualifications,
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
  };

  if (isLocked) {
    res.json({
      locked: true,
      reason: lockReason,
      event: eventPayload,
    });
    return;
  }

  res.json({
    event: eventPayload,
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
  let qualification = null;
  let hasQualifications = false;
  let isLocked = false;
  let lockReason: string | undefined = undefined;

  if (event.type === 'TECHNICAL_QUIZ') {
    const qualCount = await prisma.quizQualification.count({
      where: { eventId: event.id },
    });
    hasQualifications = qualCount > 0;

    qualification = await prisma.quizQualification.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: req.user!.userId } },
    });
    isQualifiedForRound2 = !!qualification?.isQualified;

    if (event.round1Status === 'FINISHED' && hasQualifications && !isQualifiedForRound2) {
      isLocked = true;
      lockReason = 'not_qualified';
    }
  }

  const eventPayload = {
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
    locked: isLocked,
    reason: lockReason,
    hasQualifications,
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
  };

  if (isLocked) {
    res.json({
      locked: true,
      reason: lockReason,
      event: eventPayload,
    });
    return;
  }

  res.json({
    event: eventPayload,
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

    // Check qualification for Round 2
    let isQualified = false;
    let qualification = null;
    const qualCount = await prisma.quizQualification.count({
      where: { eventId: event.id },
    });
    const hasQualifications = qualCount > 0;

    if (hasQualifications) {
      qualification = await prisma.quizQualification.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: req.user!.userId } },
      });
      isQualified = !!qualification?.isQualified;
    }

    // Once round1Status is FINISHED and qualify-round1 has run:
    // users where isQualified is false or missing get locked: true, reason: "not_qualified" response
    if (round === 2) {
      if (event.round1Status === 'FINISHED' && hasQualifications && !isQualified) {
        res.json({
          locked: true,
          reason: 'not_qualified',
          round: 2,
          challenges: [],
        });
        return;
      }
      if (!isQualified && hasQualifications) {
        res.json({
          locked: true,
          reason: 'not_qualified',
          round: 2,
          challenges: [],
        });
        return;
      }

      // Qualified users get round-2 content once round2Status is RUNNING
      if (event.round2Status !== 'RUNNING') {
        res.json({
          round: 2,
          challenges: [],
          message: 'Round 2 is not currently running',
        });
        return;
      }
    }

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
        timerMode: c.timerMode || 'GLOBAL_STAGE',
        timePerQuestionSec: c.timePerQuestionSec || 0,
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

    // If student requests Round 2 content:
    if (round === 2) {
      const qualCount = await prisma.quizQualification.count({
        where: { eventId: event.id },
      });
      const hasQualifications = qualCount > 0;

      const qual = await prisma.quizQualification.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: req.user!.userId } },
      });

      // Once round1Status is FINISHED and qualify-round1 has run:
      // users where isQualified is false or missing get a locked: true, reason: "not_qualified" response
      if (event.round1Status === 'FINISHED' && hasQualifications && (!qual || !qual.isQualified)) {
        res.status(403).json({
          locked: true,
          reason: 'not_qualified',
          error: 'You are not qualified for Round 2',
          questions: [],
        });
        return;
      }

      if (!qual || !qual.isQualified) {
        res.status(403).json({
          locked: true,
          reason: 'not_qualified',
          error: 'You are not qualified for Round 2',
          questions: [],
        });
        return;
      }

      // Qualified users get round-2 content once round2Status is RUNNING
      if (event.round2Status !== 'RUNNING') {
        res.json({
          questions: [],
          message: 'Round 2 is not currently running',
        });
        return;
      }
    }

    const userId = req.user!.userId;
    let questions: any[] = [];

    if (challengeId) {
      questions = await getOrderedQuestionsForStudent(userId, challengeId);
    } else {
      const challenges = await prisma.quizChallenge.findMany({
        where: { eventId: event.id, round, isActive: true },
        orderBy: { order: 'asc' },
      });
      for (const c of challenges) {
        const cQuestions = await getOrderedQuestionsForStudent(userId, c.id);
        questions.push(...cQuestions);
      }
    }

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
    const userId = req.user!.userId;
    const challengeId = req.query.challengeId ? String(req.query.challengeId) : undefined;

    let puzzle = await prisma.puzzleSubmission.findFirst({
      where: {
        userId,
        eventId,
        ...(challengeId && { challengeId }),
      },
    });

    let targetChallengeId = challengeId;
    if (!targetChallengeId) {
      const pzChallenge = await prisma.quizChallenge.findFirst({
        where: { eventId, type: 'PUZZLE_GRID', isActive: true },
      });
      targetChallengeId = pzChallenge?.id;
    }

    if (!puzzle && targetChallengeId) {
      const challenge = await prisma.quizChallenge.findUnique({ where: { id: targetChallengeId } });
      if (challenge) {
        const initialBoard = generateSeededPuzzleBoard(userId, targetChallengeId, 28);
        puzzle = await prisma.puzzleSubmission.create({
          data: {
            userId,
            eventId,
            challengeId: targetChallengeId,
            round: challenge.round,
            moves: 0,
            timeTakenSeconds: 0,
            isSolved: false,
            initialState: JSON.stringify(initialBoard),
            currentState: JSON.stringify(initialBoard),
            pointsAwarded: 0,
          },
        });
      }
    }

    res.json({ puzzle });
  }
);

// ─── POST /api/events/:id/puzzle-state ───────────────────────────────────────
const puzzleStateSchema = z.object({
  challengeId: z.string().min(1),
  moves: z.number().int().nonnegative(),
  timeTakenSeconds: z.number().int().nonnegative(),
  currentState: z.string().default('[]'),
});

router.post(
  '/events/:id/puzzle-state',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = puzzleStateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { challengeId, moves, timeTakenSeconds, currentState } = parsed.data;
    const eventId = String(req.params.id);
    const userId = req.user!.userId;

    const puzzle = await prisma.puzzleSubmission.findUnique({
      where: { userId_challengeId: { userId, challengeId } },
    });

    if (puzzle && !puzzle.isSolved) {
      await prisma.puzzleSubmission.update({
        where: { id: puzzle.id },
        data: {
          moves,
          timeTakenSeconds,
          currentState,
        },
      });
    }

    res.json({ success: true });
  }
);

// ─── POST /api/events/:id/puzzle-submit ──────────────────────────────────────
const puzzleSubmitSchema = z.object({
  challengeId: z.string().min(1),
  moves: z.number().int().nonnegative(),
  timeTakenSeconds: z.number().int().nonnegative(),
  isSolved: z.boolean(),
  initialState: z.string().default('[]'),
  currentState: z.string().default('[]'),
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

    const { challengeId, moves, timeTakenSeconds, isSolved, initialState, currentState } = parsed.data;
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

    if (challenge.round === 2) {
      const qual = await prisma.quizQualification.findUnique({
        where: { eventId_userId: { eventId, userId } },
      });
      if (!qual || !qual.isQualified) {
        res.status(403).json({ locked: true, reason: 'not_qualified', error: 'You are not qualified for Round 2' });
        return;
      }
      if (event.round2Status !== 'RUNNING') {
        res.status(409).json({ error: 'Round 2 is not currently running' });
        return;
      }
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
        currentState: currentState || initialState,
        pointsAwarded,
      },
      update: {
        moves,
        timeTakenSeconds,
        isSolved,
        currentState: currentState || initialState,
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
        res.status(403).json({ locked: true, reason: 'not_qualified', error: 'You are not qualified for Round 2' });
        return;
      }
      if (event.round2Status !== 'RUNNING') {
        res.status(409).json({ error: 'Round 2 is not currently running' });
        return;
      }
    }

    // Server-side correctness check (accounting for student-specific option remapping)
    const { isCorrect, pointsAwarded } = await validateStudentAnswer(userId, question, selectedAnswer);

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

// ─── DEBUGGING ROUTES ────────────────────────────────────────────────────────
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
        sampleTestCases: true,
        testCases: true,
        points: true,
        timeLimit: true,
        order: true,
      },
    });

    const formattedProblems = problems.map((p) => {
      let sampleCases: TestCase[] = [];
      try {
        const parsed = typeof p.sampleTestCases === 'string' ? JSON.parse(p.sampleTestCases) : p.sampleTestCases;
        if (Array.isArray(parsed) && parsed.length > 0) {
          sampleCases = parsed;
        }
      } catch {}

      if (sampleCases.length === 0) {
        try {
          const parsed = typeof p.testCases === 'string' ? JSON.parse(p.testCases) : p.testCases;
          if (Array.isArray(parsed) && parsed.length > 0) {
            sampleCases = [parsed[0]];
          } else {
            sampleCases = [{ input: '', expectedOutput: p.expectedOutput }];
          }
        } catch {
          sampleCases = [{ input: '', expectedOutput: p.expectedOutput }];
        }
      }

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        buggyCode: p.buggyCode,
        expectedOutput: sampleCases[0]?.expectedOutput || p.expectedOutput,
        sampleInput: sampleCases[0]?.input || '',
        sampleTestCases: sampleCases,
        points: p.points,
        timeLimit: p.timeLimit,
        order: p.order,
      };
    });

    res.json({ problems: formattedProblems });
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

    const { code, input, problemId } = req.body as { code: string; input?: string; problemId?: string };
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Code is required' });
      return;
    }

    let sampleCases: TestCase[] = [];
    if (problemId) {
      const problem = await prisma.debuggingProblem.findFirst({
        where: { id: problemId, eventId: event.id },
      });
      if (problem) {
        try {
          const parsed = typeof problem.sampleTestCases === 'string' ? JSON.parse(problem.sampleTestCases) : problem.sampleTestCases;
          if (Array.isArray(parsed) && parsed.length > 0) {
            sampleCases.push(...parsed);
          }
        } catch {}

        if (sampleCases.length === 0) {
          try {
            const parsed = typeof problem.testCases === 'string' ? JSON.parse(problem.testCases) : problem.testCases;
            if (Array.isArray(parsed) && parsed.length > 0) {
              sampleCases.push(parsed[0]);
            } else {
              sampleCases.push({ input: input || '', expectedOutput: problem.expectedOutput });
            }
          } catch {
            sampleCases.push({ input: input || '', expectedOutput: problem.expectedOutput });
          }
        }
      }
    }

    if (sampleCases.length === 0) {
      sampleCases = [{ input: input || '', expectedOutput: '' }];
    }

    const result = await executeSampleTestCases(code, sampleCases, 5);
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

    // Extract sample cases
    const sampleCases: TestCase[] = [];
    try {
      const parsedSample = typeof problem.sampleTestCases === 'string' ? JSON.parse(problem.sampleTestCases) : problem.sampleTestCases;
      if (Array.isArray(parsedSample) && parsedSample.length > 0) {
        sampleCases.push(...parsedSample);
      }
    } catch {}

    if (sampleCases.length === 0) {
      try {
        const parsed = typeof problem.testCases === 'string' ? JSON.parse(problem.testCases) : problem.testCases;
        if (Array.isArray(parsed) && parsed.length > 0) {
          sampleCases.push(parsed[0]);
        } else {
          sampleCases.push({ input: '', expectedOutput: problem.expectedOutput });
        }
      } catch {
        sampleCases.push({ input: '', expectedOutput: problem.expectedOutput });
      }
    }

    // Extract hidden cases
    const hiddenCases: TestCase[] = [];
    try {
      const parsedHidden = typeof problem.hiddenTestCases === 'string' ? JSON.parse(problem.hiddenTestCases) : problem.hiddenTestCases;
      if (Array.isArray(parsedHidden) && parsedHidden.length > 0) {
        hiddenCases.push(...parsedHidden);
      }
    } catch {}

    if (hiddenCases.length === 0) {
      try {
        const parsed = typeof problem.testCases === 'string' ? JSON.parse(problem.testCases) : problem.testCases;
        if (Array.isArray(parsed) && parsed.length > 1) {
          hiddenCases.push(...parsed.slice(1));
        }
      } catch {}
    }

    const execResult = await executeSubmissionEvaluation(
      code,
      sampleCases,
      hiddenCases,
      problem.timeLimit || 5
    );

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

    let nextProblem = null;
    if (execResult.result === 'ACCEPTED') {
      nextProblem = await prisma.debuggingProblem.findFirst({
        where: { eventId, order: { gt: problem.order } },
        orderBy: { order: 'asc' },
      });

      // Emit Socket.IO event to unlock Problem N+1 for student and inform admin
      const io = req.app.get('io');
      if (io) {
        io.to(`event:${eventId}`).emit('debugging:problem_solved', {
          userId,
          eventId,
          problemId,
          nextProblemId: nextProblem?.id,
          pointsAwarded: submission.pointsAwarded,
        });
      }
    }

    res.json({
      submission: {
        id: submission.id,
        result: submission.result,
        compileOutput: submission.compileOutput,
        runOutput: submission.runOutput,
        pointsAwarded: submission.pointsAwarded,
        passedCases: execResult.passedCases,
        totalCases: execResult.totalCases,
        testCases: execResult.testCases,
        nextProblemId: nextProblem?.id,
        submittedAt: submission.submittedAt.toISOString(),
      },
    });
  }
);

export default router;
