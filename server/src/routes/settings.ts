import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthenticatedRequest } from '../types';

export const settingsRouter = Router();

const UpdateSettingsSchema = z.object({
  body: z.object({
    voiceEnabled: z.boolean().optional(),
    cameraEnabled: z.boolean().optional(),
    wakeWord: z.string().optional(),
    startWithWindows: z.boolean().optional(),
    defaultModel: z.string().nullable().optional(),
    preferredProvider: z.string().nullable().optional(),
    fallbackEnabled: z.boolean().optional(),
    crossProviderFallback: z.boolean().optional(),
    costPreference: z.enum(['low', 'balanced', 'high']).optional(),
    speedPreference: z.enum(['low', 'balanced', 'high']).optional(),
    qualityPreference: z.enum(['low', 'balanced', 'high']).optional(),
    logLevel: z.enum(['DEBUG', 'INFO', 'WARNING', 'ERROR']).optional(),
    rawJson: z.any().optional(),
  }),
});

// GET /api/settings - Retrieve user settings
settingsRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  let settings = await prisma.settings.findUnique({
    where: { userId: req.user!.id },
  });

  if (!settings) {
    settings = await prisma.settings.create({
      data: {
        userId: req.user!.id,
      },
    });
  }

  res.json({
    success: true,
    data: settings,
  });
});

// PUT /api/settings - Update user settings
settingsRouter.put(
  '/',
  requireAuth,
  validate(UpdateSettingsSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const updated = await prisma.settings.upsert({
      where: { userId: req.user!.id },
      update: req.body,
      create: {
        userId: req.user!.id,
        ...req.body,
      },
    });

    res.json({
      success: true,
      data: updated,
    });
  }
);
