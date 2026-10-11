import { RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthenticatedRequest } from '../types';

// Static registry of supported models by provider
const PROVIDER_MODELS: Record<string, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o1-preview',
    'o1-mini',
    'o3-mini',
    'gpt-4o-realtime-preview',
    'whisper-1',
    'tts-1',
    'tts-1-hd',
  ],
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'],
  google: [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-pro-preview',
  ],
};

const RegisterKeySchema = z.object({
  body: z.object({
    provider: z.enum(['openai', 'anthropic', 'google']),
    keySlot: z.number().int().min(1).max(3),
    apiKey: z.string().min(10),
  }),
});

type Provider = z.infer<typeof RegisterKeySchema>['body']['provider'];
type CredentialStore = Pick<typeof prisma.apiCredential, 'findMany' | 'upsert'>;
type CredentialValidator = (provider: Provider, apiKey: string) => Promise<boolean>;

interface ModelsRouterOptions {
  credentialStore?: CredentialStore;
  authenticate?: RequestHandler;
  validateCredential?: CredentialValidator;
}

export function createModelsRouter({
  credentialStore = prisma.apiCredential,
  authenticate = requireAuth,
  validateCredential,
}: ModelsRouterOptions = {}) {
  const router = Router();

  // GET /api/models - Returns models for configured providers
  router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const credentials = await credentialStore.findMany({
      where: {
        userId: req.user!.id,
        isActive: true,
        healthStatus: { in: ['configured', 'healthy', 'rate_limited'] },
      },
    });

    const configuredProviders: string[] = Array.from(
      new Set(credentials.map((credential: any) => (credential.provider as string).toLowerCase()))
    );
    const availableModels: Array<{ id: string; provider: string }> = [];

    for (const provider of configuredProviders) {
      for (const modelId of PROVIDER_MODELS[provider] || []) {
        availableModels.push({ id: modelId, provider });
      }
    }

    res.json({ success: true, data: { configuredProviders, availableModels } });
  });

  // POST /api/models/credentials - Stores only a key hash (never plaintext).
  router.post(
    '/credentials',
    authenticate,
    validate(RegisterKeySchema),
    async (req: AuthenticatedRequest, res: Response) => {
      const { provider, keySlot, apiKey } = req.body;
      let healthStatus = 'configured';
      let lastValidatedAt: Date | null = null;

      if (validateCredential) {
        try {
          const isValid = await validateCredential(provider, apiKey);
          if (!isValid) {
            res.status(422).json({
              success: false,
              error: { code: 'INVALID_CREDENTIAL', message: 'The provider rejected this credential.' },
            });
            return;
          }
          healthStatus = 'healthy';
          lastValidatedAt = new Date();
        } catch {
          res.status(502).json({
            success: false,
            error: { code: 'PROVIDER_VALIDATION_FAILED', message: 'Credential validation could not be completed.' },
          });
          return;
        }
      }

      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

      try {
        const credential = await credentialStore.upsert({
          where: {
            userId_provider_keySlot: {
              userId: req.user!.id,
              provider,
              keySlot,
            },
          },
          update: {
            keyHash,
            healthStatus,
            isActive: true,
            lastValidatedAt,
          },
          create: {
            userId: req.user!.id,
            provider,
            keySlot,
            keyHash,
            healthStatus,
            isActive: true,
            lastValidatedAt,
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
      } catch {
        res.status(500).json({
          success: false,
          error: { code: 'CREDENTIAL_STORAGE_FAILED', message: 'Credential could not be saved.' },
        });
      }
    }
  );

  return router;
}

export const modelsRouter = createModelsRouter();
