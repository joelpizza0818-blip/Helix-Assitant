import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendVersionUpdateEmail, VersionUpdatePayload } from '../lib/mailer';
import { logger } from '../lib/logger';
import { requireAdminAuth } from '../middleware/adminAuth';
import { broadcastRateLimiter } from '../middleware/rateLimiter';
import { prisma } from '../lib/prisma';

export const updatesRouter = Router();

// Kept only for isolated tests/local development without DATABASE_URL.
const subscribersSet = new Set<string>();

const isTestRuntime = process.env.NODE_ENV === 'test' || process.execArgv.includes('--test') || Boolean(process.env.NODE_TEST_CONTEXT);
const usePersistentStore = () => !isTestRuntime && (process.env.NODE_ENV === 'production' || Boolean(process.env.DATABASE_URL));

async function addSubscriber(email: string): Promise<number> {
  if (!usePersistentStore()) {
    subscribersSet.add(email);
    return subscribersSet.size;
  }

  await prisma.updateSubscriber.upsert({
    where: { email },
    create: { email, isActive: true },
    update: { isActive: true, unsubscribedAt: null },
  });
  return prisma.updateSubscriber.count({ where: { isActive: true } });
}

async function getActiveSubscribers(): Promise<string[]> {
  if (!usePersistentStore()) return Array.from(subscribersSet);
  const rows = await prisma.updateSubscriber.findMany({
    where: { isActive: true },
    select: { email: true },
  });
  return rows.map(({ email }) => email);
}

async function getSubscriberCount(): Promise<number> {
  if (!usePersistentStore()) return subscribersSet.size;
  return prisma.updateSubscriber.count({ where: { isActive: true } });
}

export function _resetSubscribersForTesting(): void {
  subscribersSet.clear();
}

const SubscribeSchema = z.object({
  email: z.string().email('Invalid email'),
});

const BroadcastSchema = z.object({
  version: z
    .string()
    .trim()
    .min(1, 'Version is required')
    .max(50, 'Version cannot exceed 50 characters')
    .regex(/^[^\r\n]+$/, 'Version cannot contain newline characters'),
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(200, 'Title cannot exceed 200 characters')
    .regex(/^[^\r\n]+$/, 'Title cannot contain newline characters'),
  changes: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'Change description cannot be empty')
        .max(500, 'Change item cannot exceed 500 characters')
    )
    .min(1, 'Changes list is required')
    .max(50, 'Cannot exceed 50 changes per release'),
  downloadUrl: z
    .string()
    .url('Invalid download URL')
    .max(1000, 'Download URL is too long')
    .optional(),
  releaseDate: z
    .string()
    .max(100, 'Release date is too long')
    .optional(),
});

// POST /api/updates/subscribe
updatesRouter.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const { email } = SubscribeSchema.parse(req.body);
    const normalized = email.toLowerCase().trim();
    const totalSubscribers = await addSubscriber(normalized);
    logger.info(`[Updates] Subscriber registered (Total: ${totalSubscribers})`);

    return res.status(200).json({
      success: true,
      message: 'Subscription request accepted by the update service.',
      totalSubscribers,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0]?.message || 'Invalid subscription data',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Internal error while registering subscription',
    });
  }
});

// POST /api/updates/broadcast
updatesRouter.post(
  '/broadcast',
  broadcastRateLimiter,
  requireAdminAuth,
  async (req: Request, res: Response) => {
    try {
      const data = BroadcastSchema.parse(req.body);
      const targetRecipients = await getActiveSubscribers();

      if (targetRecipients.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No subscribed recipients found to broadcast.',
        });
      }

      const payload: VersionUpdatePayload = {
        version: data.version,
        title: data.title,
        changes: data.changes,
        downloadUrl: data.downloadUrl,
        releaseDate: data.releaseDate,
      };

      const result = await sendVersionUpdateEmail(targetRecipients, payload);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error || 'Error sending emails',
        });
      }

      return res.status(200).json({
        success: true,
        message: `Update v${data.version} sent to ${result.sentCount} users.`,
        sentCount: result.sentCount,
        messageId: result.messageId,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: error.errors[0]?.message || 'Invalid broadcast parameters',
        });
      }
      return res.status(500).json({
        success: false,
        error: error.message || 'Internal error while processing the email broadcast',
      });
    }
  }
);

// GET /api/updates/subscribers/count
updatesRouter.get('/subscribers/count', async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, count: await getSubscriberCount() });
  } catch (error) {
    logger.error('[Updates] Unable to read subscriber count:', error);
    return res.status(503).json({ success: false, error: 'Subscriber store unavailable' });
  }
});
