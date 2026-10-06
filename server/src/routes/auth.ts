import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { authRateLimiter } from '../middleware/rateLimiter';
import { AuthenticatedRequest } from '../types';

export const authRouter = Router();

const SyncUserSchema = z.object({
  body: z.object({
    displayName: z.string().optional(),
  }),
});

// GET /api/auth/me - Retrieve current authenticated profile
authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      settings: true,
      devices: { where: { isActive: true } },
    },
  });

  res.json({
    success: true,
    data: user,
  });
});

// POST /api/auth/sync - Sync profile updates from client
authRouter.post(
  '/sync',
  authRateLimiter,
  requireAuth,
  validate(SyncUserSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const { displayName } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        displayName: displayName || undefined,
        lastLoginAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: updated,
    });
  }
);
