import { Router, Response } from 'express';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import {
  initBenchmarkTables,
  seedBenchmarkUsers,
  createBenchmarkRun,
  getBenchmarkLiveState,
  cleanupBenchmarkData,
  recordBenchmarkEvent,
  claimNextQueuedJob,
} from '../services/benchmarkService';
import { dispatchBenchmarkJobToAvailableRunner, getConnectedRunnersList } from '../services/runnerBridge';
import prisma from '../utils/prisma';

const router = Router();

/**
 * POST /api/admin/benchmark/init
 * Prepare isolated tables and 120 test accounts
 */
router.post('/init', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    await initBenchmarkTables();
    const users = await seedBenchmarkUsers(120);
    res.json({ success: true, message: 'Benchmark database tables initialized and 120 test users seeded.', userCount: users.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/benchmark/start
 * Create 120 jobs in Supabase and begin dispatching to the connected local runner
 */
router.post('/start', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const jobCount = req.body?.count ? Number(req.body.count) : 120;
    const runName = req.body?.name || `TEST_RUNNER_${Date.now()}`;
    const { runId } = await createBenchmarkRun(runName, jobCount);

    const runners = getConnectedRunnersList();
    if (runners.length === 0) {
      return res.status(503).json({
        success: false,
        error: 'No local C runner is currently connected to /runner. Start runner first.',
        runId,
      });
    }

    // Set run to RUNNING
    await prisma.$executeRawUnsafe(
      `UPDATE runner_benchmark_runs SET status = 'RUNNING', "startedAt" = NOW() WHERE id = $1;`,
      runId
    );

    // Initial fill of all available worker slots (up to capacity)
    let dispatched = 0;
    for (const runner of runners) {
      const freeSlots = runner.maxConcurrency - runner.activeJobs;
      for (let s = 0; s < freeSlots; s++) {
        const workerSlot = `worker-${s + 1}`;
        const claimed = await claimNextQueuedJob(runId, workerSlot);
        if (claimed) {
          dispatchBenchmarkJobToAvailableRunner(claimed, runner.id, workerSlot);
          dispatched++;
        }
      }
    }

    res.json({
      success: true,
      runId,
      totalJobs: jobCount,
      initialDispatched: dispatched,
      connectedRunners: runners.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/benchmark/status
 * Get real-time live run telemetry, queue depth, worker state, and recent event timeline
 */
router.get('/status', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const runId = req.query.runId ? String(req.query.runId) : undefined;
    const state = await getBenchmarkLiveState(runId);
    const runners = getConnectedRunnersList();
    res.json({
      success: true,
      data: state,
      runners,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/benchmark/cleanup
 * Surgically delete only benchmark data (BENCH001-BENCH120 and benchmark_runner_* tables)
 */
router.post('/cleanup', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await cleanupBenchmarkData();
    res.json({ success: true, message: 'Benchmark tables dropped and benchmark test accounts deleted.', result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
