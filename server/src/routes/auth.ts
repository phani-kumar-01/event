import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { signToken } from '../utils/jwt';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  rollNo: z.string().min(1, 'Roll number is required').trim().toUpperCase(),
  password: z.string().min(1, 'Password is required'),
});

router.post('/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { rollNo, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { rollNo } });
    if (!user) {
      res.status(401).json({ error: 'Invalid roll number or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid roll number or password' });
      return;
    }

    const token = signToken({
      userId: user.id,
      rollNo: user.rollNo,
      role: user.role as 'ADMIN' | 'STUDENT',
    });

    res.json({
      token,
      user: {
        id: user.id,
        rollNo: user.rollNo,
        name: user.name,
        role: user.role,
        year: user.year,
        class: user.class,
        section: user.section,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, rollNo: true, name: true, role: true, year: true, class: true, section: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (_req: Request, res: Response): void => {
  res.json({ success: true });
});

export default router;
