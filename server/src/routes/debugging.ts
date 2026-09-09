import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { executeDebuggingCode } from '../controllers/debuggingController';

const router = Router();

// POST /api/debugging/execute
router.post('/execute', requireAuth, executeDebuggingCode);

// Optional aliases
router.post('/run', requireAuth, (req, res, next) => {
  req.body.mode = 'RUN';
  return executeDebuggingCode(req, res);
});

router.post('/submit', requireAuth, (req, res, next) => {
  req.body.mode = 'SUBMIT';
  return executeDebuggingCode(req, res);
});

export default router;
