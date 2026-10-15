import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendVersionUpdateEmail, VersionUpdatePayload } from '../lib/mailer';
import { logger } from '../lib/logger';

export const updatesRouter = Router();

// In-memory subscriber list with persistent deduplication (or can be connected to Supabase/Prisma)
const subscribersSet = new Set<string>();

const SubscribeSchema = z.object({
  email: z.string().email('Email inválido'),
});

const BroadcastSchema = z.object({
  version: z.string().min(1, 'Versión requerida'),
  title: z.string().min(1, 'Título requerido'),
  changes: z.array(z.string()).min(1, 'Lista de cambios requerida'),
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
      message: 'Suscripción exitosa. Recibirás un correo cuando se publiquen nuevas versiones.',
      totalSubscribers: subscribersSet.size,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0]?.message || 'Datos de suscripción inválidos',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Error interno al registrar suscripción',
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
        error: 'No hay destinatarios suscritos ni especificados en la petición.',
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
        error: result.error || 'Error al enviar correos',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Actualización v${data.version} enviada a ${result.sentCount} usuarios.`,
      sentCount: result.sentCount,
      messageId: result.messageId,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0]?.message || 'Parámetros de broadcast inválidos',
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || 'Error interno al procesar el envío de correos',
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
