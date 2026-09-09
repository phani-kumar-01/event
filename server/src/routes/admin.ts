import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import {
  startEvent,
  pauseEvent,
  resumeEvent,
  endEvent,
  readyEvent,
  startRound1,
  pauseRound1,
  resumeRound1,
  endRound1,
  computeRound1Qualifiers,
  startRound2,
  pauseRound2,
  resumeRound2,
  endRound2,
  computeFinalRankings,
} from '../services/eventService';
import { emitEventStateChanged, emitThemeUpdated } from '../socket/socketManager';
import { Server } from 'socket.io';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function getIo(req: Request): Server {
  return req.app.get('io') as Server;
}

// ─── Events Lifecycle ─────────────────────────────────────────────────────────

router.get('/events', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const events = await prisma.event.findMany({ orderBy: { startTime: 'asc' } });
  res.json({ events });
});

router.get('/events/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  res.json({ event });
});

router.patch('/events/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    startTime,
    endTime,
    durationSeconds,
    round1Duration,
    round2Duration,
    round1Weight,
    round2Weight,
    qualifierCount,
    maxParticipants,
  } = req.body as {
    startTime?: string;
    endTime?: string;
    durationSeconds?: number;
    round1Duration?: number;
    round2Duration?: number;
    round1Weight?: number;
    round2Weight?: number;
    qualifierCount?: number;
    maxParticipants?: number;
  };

  const updated = await prisma.event.update({
    where: { id: String(req.params.id) },
    data: {
      ...(startTime && { startTime: new Date(startTime) }),
      ...(endTime && { endTime: new Date(endTime) }),
      ...(durationSeconds && { durationSeconds }),
      ...(round1Duration && { round1Duration }),
      ...(round2Duration && { round2Duration }),
      ...(round1Weight !== undefined && { round1Weight }),
      ...(round2Weight !== undefined && { round2Weight }),
      ...(qualifierCount && { qualifierCount }),
      ...(maxParticipants && { maxParticipants }),
      version: { increment: 1 },
    },
  });

  emitEventStateChanged(getIo(req), updated);
  res.json({ event: updated });
});

router.post('/events/:id/ready', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await readyEvent(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/start', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await startEvent(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/pause', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await pauseEvent(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/resume', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await resumeEvent(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/end', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await endEvent(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

// ─── Technical Quiz Specialized Round 1 & Round 2 Controls ──────────────────

router.post('/events/:id/start-round1', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await startRound1(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/pause-round1', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await pauseRound1(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/resume-round1', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await resumeRound1(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/end-round1', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await endRound1(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/qualify-round1', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const topCount = req.body?.topCount ? Number(req.body.topCount) : undefined;
    const result = await computeRound1Qualifiers(String(req.params.id), topCount);
    res.json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/start-round2', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await startRound2(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/pause-round2', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await pauseRound2(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/resume-round2', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await resumeRound2(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/end-round2', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await endRound2(String(req.params.id));
    emitEventStateChanged(getIo(req), event);
    res.json({ event });
  } catch (e: unknown) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.post('/events/:id/compute-final-rankings', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await computeFinalRankings(String(req.params.id));
    res.json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.get('/events/:id/round1-leaderboard', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const eventId = String(req.params.id);
  const qualifications = await prisma.quizQualification.findMany({
    where: { eventId },
    include: { user: { select: { id: true, rollNo: true, name: true } } },
    orderBy: { round1Rank: 'asc' },
  });
  res.json({ qualifications });
});

router.get('/events/:id/final-leaderboard', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const eventId = String(req.params.id);
  const rankings = await prisma.quizQualification.findMany({
    where: { eventId },
    include: { user: { select: { id: true, rollNo: true, name: true } } },
    orderBy: [{ finalRank: 'asc' }, { round1Rank: 'asc' }],
  });
  res.json({ rankings });
});

// ─── Quiz Challenges CRUD ─────────────────────────────────────────────────────

const challengeSchema = z.object({
  eventId: z.string().min(1),
  round: z.number().int().min(1).max(2).default(1),
  type: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().default(''),
  description: z.string().default(''),
  order: z.number().int().default(0),
  points: z.number().int().positive().default(100),
  timeLimit: z.number().int().nonnegative().default(0),
  config: z.string().default('{}'),
  isActive: z.boolean().default(true),
  isLocked: z.boolean().default(false),
});

router.get('/quiz-challenges', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const round = req.query.round ? Number(req.query.round) : undefined;
  const challenges = await prisma.quizChallenge.findMany({
    where: { ...(round && { round }) },
    orderBy: [{ round: 'asc' }, { order: 'asc' }],
    include: {
      _count: { select: { questions: true } },
    },
  });
  res.json({ challenges });
});

router.post('/quiz-challenges', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const challenge = await prisma.quizChallenge.create({ data: parsed.data });
  res.status(201).json({ challenge });
});

router.patch('/quiz-challenges/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = challengeSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const updated = await prisma.quizChallenge.update({
    where: { id: String(req.params.id) },
    data: parsed.data,
  });
  res.json({ challenge: updated });
});

router.delete('/quiz-challenges/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.quizChallenge.delete({ where: { id: String(req.params.id) } }).catch(() => null);
  res.json({ success: true });
});

// ─── Quiz Questions CRUD ──────────────────────────────────────────────────────

const quizSchema = z.object({
  eventId: z.string().min(1),
  challengeId: z.string().optional().nullable(),
  round: z.number().int().min(1).max(2).default(1),
  category: z.string().default('TECH'),
  type: z.string().default('MCQ'),
  question: z.string().min(1),
  imageUrl: z.string().default(''),
  optionA: z.string().default(''),
  optionB: z.string().default(''),
  optionC: z.string().default(''),
  optionD: z.string().default(''),
  correctAnswer: z.string().min(1),
  explanation: z.string().default(''),
  points: z.number().int().positive().default(10),
  order: z.number().int().default(0),
});

router.get('/quiz-questions', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const round = req.query.round ? Number(req.query.round) : undefined;
  const challengeId = req.query.challengeId ? String(req.query.challengeId) : undefined;

  const questions = await prisma.quizQuestion.findMany({
    where: {
      ...(round && { round }),
      ...(challengeId && { challengeId }),
    },
    orderBy: [{ round: 'asc' }, { order: 'asc' }],
    include: { challenge: { select: { title: true, type: true } } },
  });
  res.json({ questions });
});

router.post('/quiz-questions', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const question = await prisma.quizQuestion.create({ data: parsed.data });
  res.status(201).json({ question });
});

router.patch('/quiz-questions/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = quizSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const updated = await prisma.quizQuestion.update({
    where: { id: String(req.params.id) },
    data: parsed.data,
  });
  res.json({ question: updated });
});

router.delete('/quiz-questions/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.quizQuestion.delete({ where: { id: String(req.params.id) } }).catch(() => null);
  res.json({ success: true });
});

// ─── Excel Import ─────────────────────────────────────────────────────────────

router.get('/quiz-questions/template', requireAdmin, (_req: Request, res: Response): void => {
  const ws = XLSX.utils.aoa_to_sheet([
    [
      'round',
      'category',
      'type',
      'question',
      'optionA',
      'optionB',
      'optionC',
      'optionD',
      'correctAnswer',
      'explanation',
      'points',
    ],
    [
      '1',
      'AI',
      'MCQ',
      'Which model was created by Google DeepMind?',
      'Claude',
      'Gemini',
      'GPT-4',
      'Llama',
      'B',
      'Gemini is developed by Google DeepMind.',
      '15',
    ],
    [
      '2',
      'FACT_CHECK',
      'REAL_OR_FAKE',
      'Apple released a clothing line in 1986 called The Apple Collection.',
      'REAL',
      'FAKE',
      '',
      '',
      'REAL',
      'Apple launched a clothing collection in 1986.',
      '20',
    ],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="tech-quiz-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.post(
  '/quiz-questions/import',
  requireAdmin,
  upload.single('file'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { eventId, challengeId, round } = req.body as {
      eventId: string;
      challengeId?: string;
      round?: string;
    };

    if (!eventId) {
      res.status(400).json({ error: 'eventId is required' });
      return;
    }

    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch {
      res.status(400).json({ error: 'Invalid Excel file' });
      return;
    }

    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

    type ImportRow = {
      round: number;
      category: string;
      type: string;
      question: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      correctAnswer: string;
      explanation: string;
      points: number;
    };

    const errors: string[] = [];
    const validRows: ImportRow[] = [];

    rows.forEach((row, i) => {
      const rowNum = i + 2;
      const r = row as Record<string, unknown>;

      const qRound = Number(r['round']) || Number(round) || 1;
      const category = String(r['category'] || 'TECH').trim();
      const type = String(r['type'] || 'MCQ').trim();
      const question = String(r['question'] || '').trim();
      const optionA = String(r['optionA'] || '').trim();
      const optionB = String(r['optionB'] || '').trim();
      const optionC = String(r['optionC'] || '').trim();
      const optionD = String(r['optionD'] || '').trim();
      const correctAnswer = String(r['correctAnswer'] || '').trim();
      const explanation = String(r['explanation'] || '').trim();
      const points = Number(r['points']) || 10;

      if (!question) {
        errors.push(`Row ${rowNum}: question is missing`);
        return;
      }
      if (!correctAnswer) {
        errors.push(`Row ${rowNum}: correctAnswer is missing`);
        return;
      }

      validRows.push({
        round: qRound,
        category,
        type,
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        correctAnswer,
        explanation,
        points,
      });
    });

    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }

    const maxOrder = await prisma.quizQuestion.count({ where: { eventId } });

    const created = await prisma.quizQuestion.createMany({
      data: validRows.map((r, i) => ({
        eventId,
        challengeId: challengeId || null,
        round: r.round,
        category: r.category,
        type: r.type,
        question: r.question,
        optionA: r.optionA,
        optionB: r.optionB,
        optionC: r.optionC,
        optionD: r.optionD,
        correctAnswer: r.correctAnswer,
        explanation: r.explanation,
        points: r.points,
        order: maxOrder + i + 1,
      })),
    });

    res.json({ imported: created.count, total: rows.length });
  }
);

// ─── Debugging Problems (Intact) ──────────────────────────────────────────────

const debugSchema = z.object({
  eventId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  buggyCode: z.string().min(1),
  expectedOutput: z.string().min(1),
  testCases: z.array(z.object({ input: z.string(), expectedOutput: z.string() })).default([]),
  points: z.number().int().positive().default(100),
  timeLimit: z.number().int().positive().default(5),
  order: z.number().int().default(0),
});

router.get('/debugging-problems', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const problems = await prisma.debuggingProblem.findMany({
    orderBy: [{ eventId: 'asc' }, { order: 'asc' }],
  });
  res.json({ problems });
});

router.post('/debugging-problems', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = debugSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const problem = await prisma.debuggingProblem.create({
    data: {
      ...parsed.data,
      testCases: JSON.stringify(parsed.data.testCases),
    },
  });
  res.status(201).json({ problem });
});

router.patch('/debugging-problems/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const problem = await prisma.debuggingProblem.findUnique({ where: { id: String(req.params.id) } });
  if (!problem) {
    res.status(404).json({ error: 'Problem not found' });
    return;
  }

  const parsed = debugSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { testCases, ...rest } = parsed.data;
  const updated = await prisma.debuggingProblem.update({
    where: { id: String(req.params.id) },
    data: {
      ...rest,
      ...(testCases !== undefined && { testCases: JSON.stringify(testCases) }),
    },
  });
  res.json({ problem: updated });
});

router.delete('/debugging-problems/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.debuggingProblem.delete({ where: { id: String(req.params.id) } }).catch(() => null);
  res.json({ success: true });
});

// ─── Students ─────────────────────────────────────────────────────────────────

router.get('/students', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT' },
    select: { id: true, rollNo: true, name: true, createdAt: true },
    orderBy: { rollNo: 'asc' },
  });
  res.json({ students });
});

router.post('/students', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { rollNo, name, password } = req.body as { rollNo: string; name: string; password: string };
  if (!rollNo || !name || !password) {
    res.status(400).json({ error: 'rollNo, name, and password are required' });
    return;
  }

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(password, 12);

  try {
    const user = await prisma.user.create({
      data: { rollNo: rollNo.toUpperCase(), name, passwordHash: hash, role: 'STUDENT' },
      select: { id: true, rollNo: true, name: true, createdAt: true },
    });
    res.status(201).json({ user });
  } catch {
    res.status(409).json({ error: 'Roll number already exists' });
  }
});

router.delete('/students/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.user.delete({ where: { id: String(req.params.id) } }).catch(() => null);
  res.json({ success: true });
});

// ─── Results / Leaderboards ───────────────────────────────────────────────────

router.get('/results', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const events = await prisma.event.findMany();
  const results: Record<string, unknown[]> = {};

  for (const event of events) {
    if (event.type === 'DEBUGGING') {
      const submissions = await prisma.submission.groupBy({
        by: ['userId', 'problemId'],
        where: { eventId: event.id },
        _max: { pointsAwarded: true },
      });

      const userPoints: Record<string, number> = {};
      for (const s of submissions) {
        if (!userPoints[s.userId]) userPoints[s.userId] = 0;
        userPoints[s.userId] += s._max.pointsAwarded ?? 0;
      }

      const users = await prisma.user.findMany({
        where: { id: { in: Object.keys(userPoints) } },
        select: { id: true, rollNo: true, name: true },
      });

      results[event.type] = users
        .map((u) => ({ ...u, totalPoints: userPoints[u.id] || 0 }))
        .sort((a, b) => b.totalPoints - a.totalPoints);
    } else {
      // Technical Quiz: Return complete results with Round 1, Round 2, and Final Ranks
      const qualifications = await prisma.quizQualification.findMany({
        where: { eventId: event.id },
        include: { user: { select: { id: true, rollNo: true, name: true } } },
        orderBy: [{ finalRank: 'asc' }, { round1Rank: 'asc' }],
      });

      if (qualifications.length > 0) {
        results[event.type] = qualifications.map((q) => ({
          rollNo: q.user.rollNo,
          name: q.user.name,
          round1Score: q.round1Score,
          round1Rank: q.round1Rank,
          round2Score: q.round2Score,
          isQualified: q.isQualified,
          totalPoints: q.finalScore || q.round1Score,
          finalRank: q.finalRank,
        }));
      } else {
        // Fallback if qualifications not computed yet
        const answers = await prisma.answer.groupBy({
          by: ['userId'],
          where: { eventId: event.id },
          _sum: { pointsAwarded: true },
          _count: { id: true },
        });

        const users = await prisma.user.findMany({
          where: { id: { in: answers.map((a) => a.userId) } },
          select: { id: true, rollNo: true, name: true },
        });
        const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

        results[event.type] = answers
          .map((a) => ({
            ...userMap[a.userId],
            totalPoints: a._sum.pointsAwarded ?? 0,
            answeredCount: a._count.id,
          }))
          .sort((a, b) => (b.totalPoints as number) - (a.totalPoints as number));
      }
    }
  }

  res.json({ results });
});

// ─── Themes ───────────────────────────────────────────────────────────────────

router.get('/themes', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const themes = await prisma.themeSettings.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json({ themes });
});

router.post('/theme/activate', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { themeId } = req.body as { themeId: string };
  if (!themeId) {
    res.status(400).json({ error: 'themeId is required' });
    return;
  }

  const theme = await prisma.themeSettings.findUnique({ where: { id: themeId } });
  if (!theme) {
    res.status(404).json({ error: 'Theme not found' });
    return;
  }

  await prisma.themeSettings.updateMany({ data: { isActive: false } });
  const activated = await prisma.themeSettings.update({
    where: { id: themeId },
    data: { isActive: true, version: { increment: 1 } },
  });

  emitThemeUpdated(getIo(req), activated);
  res.json({ theme: activated });
});

export default router;
