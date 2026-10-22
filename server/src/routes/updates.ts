import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendVersionUpdateEmail, VersionUpdatePayload } from '../lib/mailer';
import { logger } from '../lib/logger';
import { requireAdminAuth } from '../middleware/adminAuth';
import { broadcastRateLimiter } from '../middleware/rateLimiter';

export const updatesRouter = Router();

// In-memory subscriber list with persistent deduplication (or can be connected to Supabase/Prisma)
const subscribersSet = new Set<string>();

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
updatesRouter.post('/subscribe', (req: Request, res: Response) => {
  try {
    const { email } = SubscribeSchema.parse(req.body);
    const normalized = email.toLowerCase().trim();
    subscribersSet.add(normalized);
    logger.info(`[Updates] Subscriber registered (Total: ${subscribersSet.size})`);

    return res.status(200).json({
      success: true,
      message: 'Subscription request accepted by the update service.',
      totalSubscribers: subscribersSet.size,
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
      const targetRecipients = Array.from(subscribersSet);

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
updatesRouter.get('/subscribers/count', (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    count: subscribersSet.size,
  });
});
