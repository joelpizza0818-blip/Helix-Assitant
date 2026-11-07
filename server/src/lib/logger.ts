import winston from 'winston';

const redactSensitive = winston.format((info) => {
  const SENSITIVE_KEYS = ['password', 'token', 'apiKey', 'key', 'secret', 'authorization'];
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (value === null || typeof value !== 'object') return value;
    const copy: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      copy[key] = SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey))
        ? '[REDACTED]'
        : redact(nestedValue);
    }
    return copy;
  };
  return redact(info) as typeof info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    redactSensitive(),
    winston.format.json()
  ),
  defaultMeta: { service: 'helix-server' },
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === 'production'
          ? winston.format.json()
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.printf(({ level, message, timestamp, ...meta }) => {
                const metaStr = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : '';
                return `[${timestamp}] ${level}: ${message}${metaStr}`;
              })
            ),
    }),
  ],
});
