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
import { emitEventStateChanged } from '../socket/socketManager';
import path from 'path';
import fs from 'fs';
import { Server } from 'socket.io';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const questionsUploadDir = path.join(__dirname, '../../uploads/questions');
if (!fs.existsSync(questionsUploadDir)) {
  fs.mkdirSync(questionsUploadDir, { recursive: true });
}

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, questionsUploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `question-${uniqueSuffix}${ext}`);
  },
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});

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
  timerMode: z.string().default('GLOBAL_STAGE'),
  timePerQuestionSec: z.number().int().nonnegative().default(0),
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

const VALID_CATEGORIES = ['AI', 'GADGETS', 'CYBERSECURITY', 'SPACE', 'GAMING', 'FOUNDERS', 'TECH_SHUFFLE', 'PUZZLE_GRID'] as const;

const quizSchema = z.object({
  eventId: z.string().min(1),
  challengeId: z.string().optional().nullable(),
  round: z.number().int().min(1).max(2).default(1),
  category: z.enum(VALID_CATEGORIES).default('AI'),
  type: z.string().default('MCQ'),
  question: z.string().min(1),
  imageUrl: z.string().default(''),
  optionA: z.string().default(''),
  optionB: z.string().default(''),
  optionC: z.string().default(''),
  optionD: z.string().default(''),
  correctAnswer: z.string().min(1),
  correctSequence: z.string().default('[]'),
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

router.post(
  '/quiz-questions/upload-image',
  requireAdmin,
  (req: Request, res: Response): void => {
    imageUpload.single('image')(req, res, (err: unknown) => {
      if (err) {
        if ((err as Error).message === 'INVALID_MIME_TYPE') {
          res.status(400).json({ error: 'Invalid file format. Only JPG, PNG, and WEBP image files are allowed.' });
          return;
        }
        res.status(400).json({ error: (err as Error).message || 'Image upload failed. Maximum size is 5MB.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No image file uploaded.' });
        return;
      }
      const imageUrl = `/uploads/questions/${req.file.filename}`;
      res.json({ imageUrl, filename: req.file.filename });
    });
  }
);

router.post(
  '/quiz-questions/:id/upload-image',
  requireAdmin,
  (req: Request, res: Response): void => {
    imageUpload.single('image')(req, res, async (err: unknown) => {
      if (err) {
        if ((err as Error).message === 'INVALID_MIME_TYPE') {
          res.status(400).json({ error: 'Invalid file format. Only JPG, PNG, and WEBP image files are allowed.' });
          return;
        }
        res.status(400).json({ error: (err as Error).message || 'Image upload failed. Maximum size is 5MB.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No image file uploaded.' });
        return;
      }
      const id = String(req.params.id);
      const imageUrl = `/uploads/questions/${req.file.filename}`;
      try {
        const question = await prisma.quizQuestion.update({
          where: { id },
          data: { imageUrl },
        });
        res.json({ imageUrl, question });
      } catch {
        res.status(404).json({ error: 'Question not found' });
      }
    });
  }
);

router.post('/quiz-questions', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  // Validate that GUESS_THE_TECH questions require an imageUrl
  if (parsed.data.challengeId) {
    const challenge = await prisma.quizChallenge.findUnique({ where: { id: parsed.data.challengeId } });
    if (challenge?.type === 'GUESS_THE_TECH' && (!parsed.data.imageUrl || !parsed.data.imageUrl.trim())) {
      res.status(400).json({ error: 'Image is required for GUESS_THE_TECH challenge questions.' });
      return;
    }
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

  // Validate that GUESS_THE_TECH questions require an imageUrl
  if (parsed.data.challengeId || parsed.data.imageUrl !== undefined) {
    const existing = await prisma.quizQuestion.findUnique({ where: { id: String(req.params.id) } });
    const targetChallengeId = parsed.data.challengeId ?? existing?.challengeId;
    const targetImageUrl = parsed.data.imageUrl ?? existing?.imageUrl;

    if (targetChallengeId) {
      const challenge = await prisma.quizChallenge.findUnique({ where: { id: targetChallengeId } });
      if (challenge?.type === 'GUESS_THE_TECH' && (!targetImageUrl || !targetImageUrl.trim())) {
        res.status(400).json({ error: 'Image is required for GUESS_THE_TECH challenge questions.' });
        return;
      }
    }
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
      'FOUNDERS',
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
      const rawCategory = String(r['category'] || 'AI').trim().toUpperCase();
      const category = (VALID_CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : 'AI';
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

router.get('/students/template', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const wsData = [
    ['SASI Engineers\' Day — Bulk Student Roster Import Template', '', '', '', '', '', ''],
    ['Fill student details to generate credentials and assign Round 1 access.', '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['Student_ID / Regd_No', 'Full_Name', 'Department', 'Year', 'Section', 'Email_Address', 'Assigned_Round'],
    ['22A81A0501', 'Aarav Sharma', 'CSE', '3rd Year', 'A', 'aarav.cse@sasi.ac.in', 'Round 1'],
    ['22A81A0502', 'Bhavya Reddy', 'CSE', '3rd Year', 'B', 'bhavya.cse@sasi.ac.in', 'Round 1'],
    ['22A81A0401', 'Chaitanya Verma', 'ECE', '3rd Year', 'A', 'chaitanya.ece@sasi.ac.in', 'Round 1'],
    ['22A81A1201', 'Divya Sri', 'IT', '2nd Year', 'A', 'divya.it@sasi.ac.in', 'Round 1'],
    ['22A81A0201', 'Eswar Kumar', 'EEE', '4th Year', 'A', 'eswar.eee@sasi.ac.in', 'Round 1'],
    ['22A81A0301', 'Farhan Ahmed', 'MECH', '3rd Year', 'A', 'farhan.mech@sasi.ac.in', 'Round 1'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Student Roster Import');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="SASI_Student_Roster_Import_Template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.post(
  '/students/import-excel',
  requireAdmin,
  upload.single('file'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'No Excel file uploaded' });
      return;
    }

    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch {
      res.status(400).json({ error: 'Invalid Excel file format' });
      return;
    }

    const sheetName = wb.SheetNames.includes('Student Roster Import')
      ? 'Student Roster Import'
      : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

    // Find header row
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const row = rawRows[i] as string[];
      if (
        row.some(
          (cell) =>
            typeof cell === 'string' &&
            (cell.toLowerCase().includes('student') ||
              cell.toLowerCase().includes('regd') ||
              cell.toLowerCase().includes('roll'))
        )
      ) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      res.status(400).json({ error: 'Could not detect column headers in the uploaded Excel worksheet.' });
      return;
    }

    const headers = (rawRows[headerRowIdx] as string[]).map((h) => String(h || '').trim().toLowerCase());
    const regdCol = headers.findIndex((h) => h.includes('student') || h.includes('regd') || h.includes('roll'));
    const nameCol = headers.findIndex((h) => h.includes('name'));

    if (regdCol === -1 || nameCol === -1) {
      res.status(400).json({ error: 'Excel sheet must contain at least Student ID/Regd No and Full Name columns.' });
      return;
    }

    const bcrypt = await import('bcryptjs');
    const defaultPasswordHash = await bcrypt.hash('student123', 10);

    const imported: { rollNo: string; name: string }[] = [];
    const errors: string[] = [];

    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r] as unknown[];
      if (!row || row.length === 0) continue;

      const rollNo = String(row[regdCol] || '').trim().toUpperCase();
      const name = String(row[nameCol] || '').trim();

      if (!rollNo || !name) continue;

      try {
        await prisma.user.upsert({
          where: { rollNo },
          create: {
            rollNo,
            name,
            passwordHash: defaultPasswordHash,
            role: 'STUDENT',
          },
          update: {
            name,
          },
        });
        imported.push({ rollNo, name });
      } catch (err) {
        errors.push(`Row ${r + 1}: ${rollNo} - ${(err as Error).message}`);
      }
    }

    res.json({
      success: true,
      importedCount: imported.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  }
);

router.delete('/students/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.user.delete({ where: { id: String(req.params.id) } }).catch(() => null);
  res.json({ success: true });
});

// ─── Results / Leaderboards & Excel Export ─────────────────────────────────────

router.get('/leaderboard/export-excel', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const eventId = req.query.eventId ? String(req.query.eventId) : undefined;
  
  let targetEvent = eventId 
    ? await prisma.event.findUnique({ where: { id: eventId } }) 
    : await prisma.event.findFirst({ where: { status: { in: ['RUNNING', 'PAUSED', 'FINISHED'] } } });

  if (!targetEvent) {
    targetEvent = await prisma.event.findFirst();
  }

  const wb = XLSX.utils.book_new();

  if (targetEvent && targetEvent.type === 'TECHNICAL_QUIZ') {
    // 1. Overall Leaderboard
    const qualifications = await prisma.quizQualification.findMany({
      where: { eventId: targetEvent.id },
      include: { user: { select: { rollNo: true, name: true } } },
      orderBy: [{ finalRank: 'asc' }, { round1Rank: 'asc' }],
    });

    const rows: (string | number)[][] = [
      ['SASI Engineers\' Day — Live Event Official Leaderboard & Round 2 Qualifiers', '', '', '', '', '', ''],
      ['Auto-calculated rankings with Department/Year breakdown and tie-breaker response latency.', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['Rank', 'Regd_No', 'Student_Name', 'Round_1_Score', 'Round_2_Score', 'Final_Score', 'Total_Time_Sec', 'Round_2_Status'],
    ];

    if (qualifications.length > 0) {
      qualifications.forEach((q, idx) => {
        const rank = q.finalRank || q.round1Rank || idx + 1;
        const status = q.isQualified ? 'QUALIFIED (Round 2)' : (rank <= 10 ? 'QUALIFIED (Round 2)' : 'Participant');
        rows.push([
          rank,
          q.user.rollNo,
          q.user.name,
          q.round1Score,
          q.round2Score,
          q.finalScore || q.round1Score,
          (q.round1Time || 0) + (q.round2Time || 0),
          status,
        ]);
      });
    } else {
      // Fallback from raw answers
      const answers = await prisma.answer.groupBy({
        by: ['userId'],
        where: { eventId: targetEvent.id },
        _sum: { pointsAwarded: true, timeTakenSeconds: true },
        _count: { id: true },
      });

      const users = await prisma.user.findMany({
        where: { id: { in: answers.map((a) => a.userId) } },
        select: { id: true, rollNo: true, name: true },
      });
      const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

      const sorted = answers
        .map((a) => ({
          user: userMap[a.userId],
          score: a._sum.pointsAwarded || 0,
          timeTaken: a._sum.timeTakenSeconds || 0,
        }))
        .sort((a, b) => b.score - a.score || a.timeTaken - b.timeTaken);

      sorted.forEach((item, idx) => {
        const rank = idx + 1;
        const status = rank <= 10 ? 'QUALIFIED (Round 2)' : 'Participant';
        rows.push([
          rank,
          item.user?.rollNo || 'N/A',
          item.user?.name || 'N/A',
          item.score,
          0,
          item.score,
          item.timeTaken,
          status,
        ]);
      });
    }

    const ws1 = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws1, 'Overall Leaderboard');

    // 2. Department Breakdown
    const deptRows: (string | number)[][] = [
      ['Department Breakdown & Distribution', '', '', ''],
      ['', '', '', ''],
      ['Department', 'Participant Count', 'Top Score', 'Average Score'],
    ];

    const allStudents = await prisma.user.findMany({ where: { role: 'STUDENT' } });
    const deptMap: Record<string, number> = {};
    allStudents.forEach((s) => {
      // Infer department from rollNo if standard SASI pattern (e.g., 22A81A05xx => CSE)
      let dept = 'GENERAL';
      const upper = s.rollNo.toUpperCase();
      if (upper.includes('05') || upper.startsWith('CS')) dept = 'CSE';
      else if (upper.includes('04') || upper.startsWith('EC')) dept = 'ECE';
      else if (upper.includes('12') || upper.startsWith('IT')) dept = 'IT';
      else if (upper.includes('02') || upper.startsWith('EE')) dept = 'EEE';
      else if (upper.includes('03') || upper.startsWith('ME')) dept = 'MECH';
      deptMap[dept] = (deptMap[dept] || 0) + 1;
    });

    Object.entries(deptMap).forEach(([dept, count]) => {
      deptRows.push([dept, count, 'Recorded', 'Active']);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(deptRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'Department Breakdown');
  } else {
    // Debugging Event Leaderboard
    const submissions = await prisma.submission.groupBy({
      by: ['userId'],
      where: { ...(targetEvent && { eventId: targetEvent.id }) },
      _sum: { pointsAwarded: true },
      _count: { id: true },
    });

    const users = await prisma.user.findMany({
      where: { id: { in: submissions.map((s) => s.userId) } },
      select: { id: true, rollNo: true, name: true },
    });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const sorted = submissions
      .map((s) => ({
        user: userMap[s.userId],
        score: s._sum.pointsAwarded || 0,
        count: s._count.id || 0,
      }))
      .sort((a, b) => b.score - a.score);

    const rows: (string | number)[][] = [
      ['SASI Engineers\' Day — C Debugging Arena Final Leaderboard', '', '', ''],
      ['', '', '', ''],
      ['Rank', 'Regd_No', 'Student_Name', 'Total_Points', 'Problems_Submitted'],
    ];

    sorted.forEach((item, idx) => {
      rows.push([idx + 1, item.user?.rollNo || 'N/A', item.user?.name || 'N/A', item.score, item.count]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Debugging Standings');
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="SASI_Engineers_Day_Leaderboard.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.get('/leaderboard', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const events = await prisma.event.findMany();

  // 1. Technical Quiz Scores
  let quizScores: any[] = [];
  const quizEvent = events.find((e) => e.type === 'TECHNICAL_QUIZ');
  if (quizEvent) {
    const qualifications = await prisma.quizQualification.findMany({
      where: { eventId: quizEvent.id },
      include: { user: { select: { id: true, rollNo: true, name: true } } },
      orderBy: [{ finalRank: 'asc' }, { round1Rank: 'asc' }],
    });

    if (qualifications.length > 0) {
      quizScores = qualifications.map((q) => ({
        id: q.id,
        userId: q.userId,
        rollNo: q.user.rollNo,
        name: q.user.name,
        round1Score: q.round1Score,
        round1Rank: q.round1Rank,
        round1Time: q.round1Time,
        round2Score: q.round2Score,
        round2Rank: q.round2Rank,
        round2Time: q.round2Time,
        finalScore: q.finalScore || q.round1Score,
        finalRank: q.finalRank,
        isQualified: q.isQualified,
        totalPoints: q.finalScore || q.round1Score,
      }));
    } else {
      const answers = await prisma.answer.groupBy({
        by: ['userId'],
        where: { eventId: quizEvent.id },
        _sum: { pointsAwarded: true, timeTakenSeconds: true },
        _count: { id: true },
      });

      const users = await prisma.user.findMany({
        where: { id: { in: answers.map((a) => a.userId) } },
        select: { id: true, rollNo: true, name: true },
      });
      const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

      quizScores = answers
        .map((a) => {
          const u = userMap[a.userId];
          return {
            id: a.userId,
            userId: a.userId,
            rollNo: u?.rollNo || 'N/A',
            name: u?.name || 'N/A',
            round1Score: a._sum.pointsAwarded ?? 0,
            round1Rank: 0,
            round1Time: a._sum.timeTakenSeconds ?? 0,
            round2Score: 0,
            round2Rank: 0,
            round2Time: 0,
            finalScore: a._sum.pointsAwarded ?? 0,
            finalRank: 0,
            isQualified: false,
            totalPoints: a._sum.pointsAwarded ?? 0,
          };
        })
        .sort((a, b) => b.totalPoints - a.totalPoints || a.round1Time - b.round1Time)
        .map((item, idx) => ({
          ...item,
          round1Rank: idx + 1,
          finalRank: idx + 1,
          isQualified: idx < 10,
        }));
    }
  }

  // 2. Debugging Scores
  let debuggingScores: any[] = [];
  const debugEvent = events.find((e) => e.type === 'DEBUGGING');
  if (debugEvent) {
    const submissions = await prisma.submission.findMany({
      where: { eventId: debugEvent.id },
      include: { user: { select: { id: true, rollNo: true, name: true } } },
      orderBy: { submittedAt: 'asc' },
    });

    const userMap: Record<
      string,
      {
        userId: string;
        rollNo: string;
        name: string;
        totalPoints: number;
        problemsSolved: number;
        solvedProblemIds: Set<string>;
      }
    > = {};

    submissions.forEach((s) => {
      if (!userMap[s.userId]) {
        userMap[s.userId] = {
          userId: s.userId,
          rollNo: s.user.rollNo,
          name: s.user.name,
          totalPoints: 0,
          problemsSolved: 0,
          solvedProblemIds: new Set<string>(),
        };
      }
      if (s.result === 'ACCEPTED' && !userMap[s.userId].solvedProblemIds.has(s.problemId)) {
        userMap[s.userId].solvedProblemIds.add(s.problemId);
        userMap[s.userId].totalPoints += s.pointsAwarded;
        userMap[s.userId].problemsSolved += 1;
      }
    });

    debuggingScores = Object.values(userMap)
      .map((u) => ({
        id: u.userId,
        userId: u.userId,
        rollNo: u.rollNo,
        name: u.name,
        totalPoints: u.totalPoints,
        problemsSolved: u.problemsSolved,
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints || b.problemsSolved - a.problemsSolved)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }

  // 3. Master / Combined Scores
  const masterScoresMap: Record<
    string,
    {
      userId: string;
      rollNo: string;
      name: string;
      quizPoints: number;
      debuggingPoints: number;
      totalPoints: number;
    }
  > = {};

  quizScores.forEach((q) => {
    masterScoresMap[q.userId] = {
      userId: q.userId,
      rollNo: q.rollNo,
      name: q.name,
      quizPoints: q.totalPoints || 0,
      debuggingPoints: 0,
      totalPoints: q.totalPoints || 0,
    };
  });

  debuggingScores.forEach((d) => {
    if (!masterScoresMap[d.userId]) {
      masterScoresMap[d.userId] = {
        userId: d.userId,
        rollNo: d.rollNo,
        name: d.name,
        quizPoints: 0,
        debuggingPoints: d.totalPoints || 0,
        totalPoints: d.totalPoints || 0,
      };
    } else {
      masterScoresMap[d.userId].debuggingPoints = d.totalPoints || 0;
      masterScoresMap[d.userId].totalPoints += d.totalPoints || 0;
    }
  });

  const masterScores = Object.values(masterScoresMap)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((item, idx) => ({ ...item, rank: idx + 1, id: item.userId }));

  res.json({
    success: true,
    quizScores,
    debuggingScores,
    masterScores,
    events,
  });
});

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

export default router;
