import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthenticatedRequest } from '../types';

export const modelsRouter = Router();

// Static registry of supported models by provider
const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini', 'o3-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  google: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
};

// GET /api/models - Returns ONLY models for providers configured by the user
modelsRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  // Find configured provider credentials for this user
  const credentials = await prisma.apiCredential.findMany({
    where: {
      userId: req.user!.id,
      isActive: true,
      healthStatus: { in: ['healthy', 'rate_limited'] },
    },
  });

  const configuredProviders = Array.from(new Set(credentials.map((c) => c.provider.toLowerCase())));

  // Compile available models based ONLY on configured providers
  const availableModels: Array<{ id: string; provider: string }> = [];

  for (const provider of configuredProviders) {
    const models = PROVIDER_MODELS[provider] || [];
    for (const modelId of models) {
      availableModels.push({ id: modelId, provider });
    }
  }

  res.json({
    success: true,
    data: {
      configuredProviders,
      availableModels,
    },
  });
});

const RegisterKeySchema = z.object({
  body: z.object({
    provider: z.enum(['openai', 'anthropic', 'google']),
    keySlot: z.number().int().min(1).max(3),
    apiKey: z.string().min(10),
  }),
});

// POST /api/models/credentials - Stores key hash and health status (NEVER plaintext)
modelsRouter.post(
  '/credentials',
  requireAuth,
  validate(RegisterKeySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const { provider, keySlot, apiKey } = req.body;

    // Securely hash the key for persistence (never store plaintext)
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const credential = await prisma.apiCredential.upsert({
      where: {
        userId_provider_keySlot: {
          userId: req.user!.id,
          provider,
          keySlot,
        },
      },
      update: {
        keyHash,
        healthStatus: 'healthy',
        isActive: true,
        lastValidatedAt: new Date(),
      },
      create: {
        userId: req.user!.id,
        provider,
        keySlot,
        keyHash,
        healthStatus: 'healthy',
        isActive: true,
        lastValidatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        provider: credential.provider,
        keySlot: credential.keySlot,
        healthStatus: credential.healthStatus,
        lastValidatedAt: credential.lastValidatedAt,
      },
    });
  }
);
