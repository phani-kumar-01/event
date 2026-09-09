import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';

const router = Router();

router.get('/theme', async (_req: Request, res: Response): Promise<void> => {
  const theme = await prisma.themeSettings.findFirst({ where: { isActive: true } });
  if (!theme) {
    res.status(404).json({ error: 'No active theme found' });
    return;
  }
  res.json({ theme });
});

export default router;
