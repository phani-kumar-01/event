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
} from '../services/eventService';
import { emitEventStateChanged, emitThemeUpdated } from '../socket/socketManager';
import { Server } from 'socket.io';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Helper to get io from app
function getIo(req: Request): Server {
  return req.app.get('io') as Server;
}

// ─── Events ──────────────────────────────────────────────────────────────────

router.get('/events', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const events = await prisma.event.findMany({ orderBy: { startTime: 'asc' } });
  res.json({ events });
});

router.get('/events/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
  if (!event) { res.status(404).json({ error: 'Event not found' }); return; }
  res.json({ event });
});

router.patch('/events/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { startTime, endTime, durationSeconds } = req.body as {
    startTime?: string;
    endTime?: string;
    durationSeconds?: number;
  };

  const event = await prisma.event.findUnique({ where: { id: String(req.params.id) } });
  if (!event) { res.status(404).json({ error: 'Event not found' }); return; }

  const updated = await prisma.event.update({
    where: { id: String(req.params.id) },
    data: {
      ...(startTime && { startTime: new Date(startTime) }),
      ...(endTime && { endTime: new Date(endTime) }),
      ...(durationSeconds && { durationSeconds }),
      version: { increment: 1 },
    },
  });

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

// ─── Debugging Problems ───────────────────────────────────────────────────────

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
  if (!problem) { res.status(404).json({ error: 'Problem not found' }); return; }

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

// ─── Quiz Questions ───────────────────────────────────────────────────────────

const quizSchema = z.object({
  eventId: z.string().min(1),
  question: z.string().min(1),
  optionA: z.string().min(1),
  optionB: z.string().min(1),
  optionC: z.string().min(1),
  optionD: z.string().min(1),
  correctAnswer: z.enum(['A', 'B', 'C', 'D']),
  explanation: z.string().default(''),
  points: z.number().int().positive().default(10),
  order: z.number().int().default(0),
});

router.get('/quiz-questions', requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const questions = await prisma.quizQuestion.findMany({
    orderBy: [{ eventId: 'asc' }, { order: 'asc' }],
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
  const question = await prisma.quizQuestion.findUnique({ where: { id: String(req.params.id) } });
  if (!question) { res.status(404).json({ error: 'Question not found' }); return; }

  const parsed = quizSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const updated = await prisma.quizQuestion.update({ where: { id: String(req.params.id) }, data: parsed.data });
  res.json({ question: updated });
});

router.delete('/quiz-questions/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.quizQuestion.delete({ where: { id: String(req.params.id) } }).catch(() => null);
  res.json({ success: true });
});

// ─── Excel Import ─────────────────────────────────────────────────────────────

router.get('/quiz-questions/template', requireAdmin, (_req: Request, res: Response): void => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['question', 'optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer', 'explanation', 'points'],
    ['What is 2+2?', '3', '4', '5', '6', 'B', 'Basic arithmetic', '10'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="quiz-template.xlsx"');
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

    const { eventId } = req.body as { eventId: string };
    if (!eventId) {
      res.status(400).json({ error: 'eventId is required' });
      return;
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.type !== 'TECHNICAL_QUIZ') {
      res.status(400).json({ error: 'Must import into a Technical Quiz event' });
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
      const rowNum = i + 2; // 1-indexed, row 1 is header
      const r = row as Record<string, unknown>;

      const question = String(r['question'] || '').trim();
      const optionA = String(r['optionA'] || '').trim();
      const optionB = String(r['optionB'] || '').trim();
      const optionC = String(r['optionC'] || '').trim();
      const optionD = String(r['optionD'] || '').trim();
      const correctAnswer = String(r['correctAnswer'] || '').trim().toUpperCase();
      const explanation = String(r['explanation'] || '').trim();
      const points = Number(r['points']) || 10;

      if (!question) { errors.push(`Row ${rowNum}: question is missing`); return; }
      if (!optionA) { errors.push(`Row ${rowNum}: optionA is missing`); return; }
      if (!optionB) { errors.push(`Row ${rowNum}: optionB is missing`); return; }
      if (!optionC) { errors.push(`Row ${rowNum}: optionC is missing`); return; }
      if (!optionD) { errors.push(`Row ${rowNum}: optionD is missing`); return; }
      if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
        errors.push(`Row ${rowNum}: correctAnswer must be A, B, C, or D (got "${correctAnswer}")`);
        return;
      }
      if (points <= 0 || isNaN(points)) {
        errors.push(`Row ${rowNum}: points must be a positive number`);
        return;
      }

      validRows.push({ question, optionA, optionB, optionC, optionD, correctAnswer, explanation, points });
    });

    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }

    if (validRows.length === 0) {
      res.status(400).json({ error: 'No valid rows found in file' });
      return;
    }

    // Get current max order
    const maxOrder = await prisma.quizQuestion.count({ where: { eventId } });

    const created = await prisma.quizQuestion.createMany({
      data: validRows.map((r, i) => ({
        eventId,
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
      // Best submission per student per problem
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
      // Sum of answers per student
      const answers = await prisma.answer.groupBy({
        by: ['userId'],
        where: { eventId: event.id },
        _sum: { pointsAwarded: true },
        _count: { id: true },
      });

      const userIds = answers.map((a) => a.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
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

  res.json({ results });
});

// ─── Theme ────────────────────────────────────────────────────────────────────

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

  // Deactivate all themes, then activate the selected one
  await prisma.themeSettings.updateMany({ data: { isActive: false } });
  const activated = await prisma.themeSettings.update({
    where: { id: themeId },
    data: { isActive: true, version: { increment: 1 } },
  });

  emitThemeUpdated(getIo(req), activated);
  res.json({ theme: activated });
});

export default router;
