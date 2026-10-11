import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

interface ErrorDetails {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  expose?: unknown;
}

const DEFAULT_CLIENT_ERROR_MESSAGE = 'The request could not be processed.';
const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred';
const PUBLIC_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function isRecord(value: unknown): value is ErrorDetails {
  return typeof value === 'object' && value !== null;
}

function getHttpStatus(error: ErrorDetails): number {
  const candidate = error.statusCode ?? error.status;
  return Number.isInteger(candidate) && Number(candidate) >= 400 && Number(candidate) <= 599
    ? Number(candidate)
    : 500;
}

function getSafeErrorCode(code: unknown): string | undefined {
  return typeof code === 'string' && PUBLIC_CODE_PATTERN.test(code) ? code : undefined;
}

function getSafeRoute(req: Request): string {
  const routePath = req.route?.path;
  if (typeof routePath !== 'string') return '/unmatched';

  const pathWithoutQuery = routePath.split(/[?#]/, 1)[0];
  return /^[A-Za-z0-9_./:*+()\\-]+$/.test(pathWithoutQuery)
    ? pathWithoutQuery
    : '/unknown';
}

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const error = isRecord(err) ? err : {};
  const statusCode = getHttpStatus(error);
  const isPublicClientError = statusCode < 500 && error.expose === true;
  const safeCode = isPublicClientError ? getSafeErrorCode(error.code) : undefined;
  const safeMessage =
    isPublicClientError && typeof error.message === 'string'
      ? error.message
      : statusCode < 500
        ? DEFAULT_CLIENT_ERROR_MESSAGE
        : INTERNAL_ERROR_MESSAGE;
  const isProduction = process.env.NODE_ENV === 'production';
  const errorName =
    typeof error.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
      ? error.name
      : 'Error';

  logger.error('Unhandled server error', {
    errorName,
    statusCode,
    categoryCode: statusCode < 500 ? 'REQUEST_ERROR' : 'INTERNAL_ERROR',
    method: /^[A-Z]{1,16}$/.test(req.method) ? req.method : 'OTHER',
    route: getSafeRoute(req),
  });

  res.status(statusCode).json({
    success: false,
    error: {
      code: isProduction
        ? statusCode < 500
          ? isPublicClientError && safeCode
            ? safeCode
            : 'REQUEST_ERROR'
          : 'INTERNAL_ERROR'
        : getSafeErrorCode(error.code) || (statusCode < 500 ? 'REQUEST_ERROR' : 'INTERNAL_ERROR'),
      message: isProduction
        ? safeMessage
        : typeof error.message === 'string'
          ? error.message
          : safeMessage,
      ...(!isProduction && typeof error.stack === 'string' && { stack: error.stack }),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
};
