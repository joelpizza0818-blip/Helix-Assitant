import { RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthenticatedRequest } from '../types';
import { PROVIDER_MODELS } from './model-catalog.generated';

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
      const models = PROVIDER_MODELS[provider] || [];
      for (const modelId of models) {
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
