import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendVersionUpdateEmail, VersionUpdatePayload } from '../lib/mailer';
import { logger } from '../lib/logger';

export const updatesRouter = Router();

// In-memory subscriber list with persistent deduplication (or can be connected to Supabase/Prisma)
const subscribersSet = new Set<string>();

const SubscribeSchema = z.object({
  email: z.string().email('Invalid email'),
});

const BroadcastSchema = z.object({
  version: z.string().min(1, 'Version is required'),
  title: z.string().min(1, 'Title is required'),
  changes: z.array(z.string()).min(1, 'Changes list is required'),
  recipients: z.array(z.string().email()).optional(),
  downloadUrl: z.string().url().optional(),
});

// POST /api/updates/subscribe
updatesRouter.post('/subscribe', (req: Request, res: Response) => {
  try {
    const { email } = SubscribeSchema.parse(req.body);
    const normalized = email.toLowerCase().trim();
    subscribersSet.add(normalized);
    logger.info(`[Updates] New subscriber registered: ${normalized} (Total: ${subscribersSet.size})`);

    return res.status(200).json({
      success: true,
      message: 'Subscription successful. You will receive an email when new versions are released.',
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
updatesRouter.post('/broadcast', async (req: Request, res: Response) => {
  try {
    const data = BroadcastSchema.parse(req.body);
    const targetRecipients = data.recipients && data.recipients.length > 0
      ? data.recipients
      : Array.from(subscribersSet);

    if (targetRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No subscribed recipients or recipients specified in the request.',
      });
    }

    const payload: VersionUpdatePayload = {
      version: data.version,
      title: data.title,
      changes: data.changes,
      downloadUrl: data.downloadUrl,
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
});

// GET /api/updates/subscribers/count
updatesRouter.get('/subscribers/count', (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    count: subscribersSet.size,
  });
});
