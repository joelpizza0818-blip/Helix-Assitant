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

export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url?: string): string {
  if (!url) return 'https://helix-assistant.dev/download';
  const trimmed = url.trim();
  // Allow only absolute http and https protocols to prevent javascript: or data: URIs
  if (/^https?:\/\/[^\s"'>]+$/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return 'https://helix-assistant.dev/download';
}

export function generateVersionUpdateHtml(payload: VersionUpdatePayload): string {
  const safeVersion = escapeHtml(payload.version);
  const safeTitle = escapeHtml(payload.title);
  const safeDownloadUrl = sanitizeUrl(payload.downloadUrl);
  const rawReleaseDate =
    payload.releaseDate ||
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const safeReleaseDate = escapeHtml(rawReleaseDate);

  const changesList = (payload.changes || [])
    .map(
      (c) =>
        `<li style="margin-bottom: 10px; color: #d4d4d4; font-size: 14px; line-height: 1.5;">
          <span style="color: #ff9f1c; margin-right: 8px;">●</span>${escapeHtml(c)}
        </li>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New HELIX Release v${safeVersion}</title>
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
                OFFICIAL HELIX UPDATE
              </div>
              <h1 style="margin: 0; font-size: 24px; color: #ffffff; font-weight: 600; letter-spacing: -0.5px;">
                HELIX v${safeVersion} is now available
              </h1>
              <div style="font-size: 13px; color: #888888; margin-top: 4px;">
                ${safeReleaseDate} · ${safeTitle}
              </div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 36px;">
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #cccccc;">
                We have released a new version of the HELIX desktop agent with performance improvements, HELIX Lite support, and updates to the control engine.
              </p>

              <div style="background: rgba(255, 159, 28, 0.04); border-left: 3px solid #ff9f1c; padding: 14px 18px; margin-bottom: 24px; border-radius: 4px;">
                <div style="font-weight: 600; font-size: 13px; color: #ffffff; margin-bottom: 4px;">Highlights:</div>
                <div style="font-size: 13px; color: #bbbbbb;">Available for both HELIX Normal (Electron) and HELIX Lite (Tauri · 15MB).</div>
              </div>

              <h2 style="font-size: 15px; color: #ffffff; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 14px;">
                What's new in this release:
              </h2>
              <ul style="padding-left: 0; list-style: none; margin: 0 0 32px;">
                ${changesList}
              </ul>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 999px; background-color: #ff9f1c;">
                    <a href="${safeDownloadUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 14px; font-weight: 600; color: #000000; text-decoration: none; border-radius: 999px; letter-spacing: -0.2px;">
                      Download Update v${safeVersion} →
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
                You are receiving this email because you subscribed to HELIX Assistant version notifications.
              </p>
              <p style="margin: 0; font-size: 11px; color: #444444;">
                HELIX Project · Local-First & Zero-Trust Desktop Assistant
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
): Promise<{ success: boolean; messageId?: string; sentCount: number; error?: string; rawMessage?: string }> {
  try {
    const transporter = getMailerTransporter();
    const from = process.env.SMTP_FROM || 'HELIX Updates <updates@helix-assistant.dev>';
    const html = generateVersionUpdateHtml(payload);

    const info = await transporter.sendMail({
      from,
      to: from || 'HELIX Subscribers <updates@helix-assistant.dev>',
      bcc: recipients,
      subject: `New HELIX Release v${payload.version}: ${payload.title}`,
      text: `HELIX v${payload.version} is now available.\n\n${payload.title}\n\nWhat's new:\n${payload.changes.map((c) => `- ${c}`).join('\n')}\n\nDownload the update at: ${payload.downloadUrl || 'https://helix-assistant.dev/download'}`,
      html,
    });

    logger.info(`[Mailer] Version update email sent for v${payload.version} to ${recipients.length} recipients. MessageId: ${info.messageId}`);
    return {
      success: true,
      messageId: info.messageId,
      sentCount: recipients.length,
      rawMessage: info.message ? info.message.toString() : undefined,
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
