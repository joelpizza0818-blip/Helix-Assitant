import nodemailer, { Transporter } from 'nodemailer';
import { logger } from './logger';

export interface VersionUpdatePayload {
  version: string;
  title: string;
  changes: string[];
  downloadUrl?: string;
  releaseDate?: string;
}

let transporterInstance: Transporter | null = null;

export function getMailerTransporter(): Transporter {
  if (transporterInstance) {
    return transporterInstance;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (host && user && pass) {
    transporterInstance = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    logger.info(`[Mailer] Configured SMTP transporter with host: ${host}:${port}`);
  } else {
    // Development fallback using JSON transport or test ethereal
    transporterInstance = nodemailer.createTransport({
      streamTransport: true,
      newline: 'windows',
      buffer: true,
    });
    logger.info('[Mailer] Running in mock/stream mode (Set SMTP_HOST, SMTP_USER, SMTP_PASS to send real emails)');
  }

  return transporterInstance;
}

export function generateVersionUpdateHtml(payload: VersionUpdatePayload): string {
  const downloadUrl = payload.downloadUrl || 'https://helix-assistant.dev/download';
  const releaseDate = payload.releaseDate || new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const changesList = payload.changes
    .map(
      (c) =>
        `<li style="margin-bottom: 10px; color: #d4d4d4; font-size: 14px; line-height: 1.5;">
          <span style="color: #ff9f1c; margin-right: 8px;">●</span>${c}
        </li>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nueva versión de HELIX v${payload.version}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #050505; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background: linear-gradient(150deg, #141414, #0a0a0a); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 36px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="font-size: 11px; letter-spacing: 2px; color: #ff9f1c; font-weight: 700; text-transform: uppercase; margin-bottom: 6px;">
                ACTUALIZACIÓN OFICIAL DE HELIX
              </div>
              <h1 style="margin: 0; font-size: 24px; color: #ffffff; font-weight: 600; letter-spacing: -0.5px;">
                HELIX v${payload.version} ya está disponible
              </h1>
              <div style="font-size: 13px; color: #888888; margin-top: 4px;">
                ${releaseDate} · ${payload.title}
              </div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 36px;">
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #cccccc;">
                Hemos lanzado una nueva versión del agente de escritorio HELIX con mejoras de rendimiento, soporte para HELIX Lite y actualizaciones en el motor de control.
              </p>

              <div style="background: rgba(255, 159, 28, 0.04); border-left: 3px solid #ff9f1c; padding: 14px 18px; margin-bottom: 24px; border-radius: 4px;">
                <div style="font-weight: 600; font-size: 13px; color: #ffffff; margin-bottom: 4px;">Aspectos destacados:</div>
                <div style="font-size: 13px; color: #bbbbbb;">Disponible tanto en HELIX Normal (Electron) como en HELIX Lite (Tauri · 15MB).</div>
              </div>

              <h2 style="font-size: 15px; color: #ffffff; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 14px;">
                Novedades en esta entrega:
              </h2>
              <ul style="padding-left: 0; list-style: none; margin: 0 0 32px;">
                ${changesList}
              </ul>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 999px; background-color: #ff9f1c;">
                    <a href="${downloadUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 14px; font-weight: 600; color: #000000; text-decoration: none; border-radius: 999px; letter-spacing: -0.2px;">
                      Descargar Actualización v${payload.version} →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 36px; background-color: #080808; border-top: 1px solid rgba(255, 255, 255, 0.08); text-align: center;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #666666;">
                Recibes este correo porque te suscribiste a las notificaciones de versiones de HELIX Assistant.
              </p>
              <p style="margin: 0; font-size: 11px; color: #444444;">
                Proyecto HELIX · Local-First & Zero-Trust Desktop Assistant
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export async function sendVersionUpdateEmail(
  recipients: string[],
  payload: VersionUpdatePayload
): Promise<{ success: boolean; messageId?: string; sentCount: number; error?: string }> {
  try {
    const transporter = getMailerTransporter();
    const from = process.env.SMTP_FROM || 'HELIX Updates <updates@helix-assistant.dev>';
    const html = generateVersionUpdateHtml(payload);

    const info = await transporter.sendMail({
      from,
      to: recipients.join(', '),
      subject: `Nueva versión de HELIX v${payload.version}: ${payload.title}`,
      text: `HELIX v${payload.version} ya está disponible.\n\n${payload.title}\n\nNovedades:\n${payload.changes.map((c) => `- ${c}`).join('\n')}\n\nDescarga la actualización en: ${payload.downloadUrl || 'https://helix-assistant.dev/download'}`,
      html,
    });

    logger.info(`[Mailer] Version update email sent for v${payload.version} to ${recipients.length} recipients. MessageId: ${info.messageId}`);
    return {
      success: true,
      messageId: info.messageId,
      sentCount: recipients.length,
    };
  } catch (error: any) {
    logger.error('[Mailer] Error sending version update email:', error);
    return {
      success: false,
      sentCount: 0,
      error: error.message || 'Failed to dispatch email',
    };
  }
}
