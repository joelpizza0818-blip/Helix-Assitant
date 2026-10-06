import winston from 'winston';

const redactSensitive = winston.format((info) => {
  const SENSITIVE_KEYS = ['password', 'token', 'apiKey', 'key', 'secret', 'authorization'];
  const redact = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(redact);
    const copy = { ...obj };
    for (const k of Object.keys(copy)) {
      if (SENSITIVE_KEYS.some((sk) => k.toLowerCase().includes(sk))) {
        copy[k] = '[REDACTED]';
      } else if (typeof copy[k] === 'object') {
        copy[k] = redact(copy[k]);
      }
    }
    return copy;
  };
  return redact(info);
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
