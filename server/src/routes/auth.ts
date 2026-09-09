import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { signToken } from '../utils/jwt';

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
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
