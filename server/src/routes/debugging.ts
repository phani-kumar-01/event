import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { executeDebuggingCode } from '../controllers/debuggingController';
import prisma, { withDbRetry } from '../utils/prisma';

const router = Router();

let cachedDebuggingEvent: any = null;
let lastDebuggingEventFetch = 0;

async function getCachedDebuggingEvent() {
  const now = Date.now();
  if (cachedDebuggingEvent && now - lastDebuggingEventFetch < 5000) {
    return cachedDebuggingEvent;
  }
  const event = await withDbRetry(() =>
    prisma.event.findFirst({
      where: { type: 'DEBUGGING' },
      include: {
        debuggingProblems: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, points: true, order: true },
        },
      },
    })
  );
  if (event) {
    cachedDebuggingEvent = event;
    lastDebuggingEventFetch = now;
  }
  return event;
}

// GET /api/debugging/progress
router.get('/progress', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const event = await getCachedDebuggingEvent();

    if (!event) {
      res.json({
        success: true,
        eventId: null,
        solvedProblemIds: [],
        totalPoints: 0,
        solvedCount: 0,
        problems: [],
      });
      return;
    }

    const submissions = await withDbRetry(() =>
      prisma.submission.findMany({
        where: {
          userId,
          eventId: event.id,
          result: 'ACCEPTED',
        },
        select: { problemId: true, pointsAwarded: true },
      })
    );

    const solvedSet = new Set(submissions.map((s) => s.problemId));
    const totalPoints = submissions.reduce((sum, s) => sum + s.pointsAwarded, 0);

    res.json({
      success: true,
      eventId: event.id,
      eventStatus: event.status,
      solvedProblemIds: Array.from(solvedSet),
      totalPoints,
      solvedCount: solvedSet.size,
      totalProblems: event.debuggingProblems.length,
      problems: event.debuggingProblems,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/debugging/execute
router.post('/execute', requireAuth, executeDebuggingCode);

// Optional aliases
router.post('/run', requireAuth, (req, res) => {
  req.body.mode = 'RUN';
  return executeDebuggingCode(req, res);
});

router.post('/submit', requireAuth, (req, res) => {
  req.body.mode = 'SUBMIT';
  return executeDebuggingCode(req, res);
});

export default router;

