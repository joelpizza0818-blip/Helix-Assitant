import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Unhandled server error', {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
};
