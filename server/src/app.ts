import express, { Request, RequestHandler, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { logger } from './lib/logger';
import { standardRateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';

import { healthRouter } from './routes/health';

interface AppOptions {
  healthRouter?: Router;
  rateLimiter?: RequestHandler;
  additionalRoutes?: Array<{ path: string; router: Router }>;
}

morgan.token('safe-path', (req) => {
  const request = req as Request;
  const routePath = request.route?.path;
  return typeof routePath === 'string' ? routePath : '/unmatched';
});

export function createApp({
  healthRouter: configuredHealthRouter = healthRouter,
  rateLimiter = standardRateLimiter,
  additionalRoutes = [],
}: AppOptions = {}) {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    morgan(':method :safe-path :status :response-time ms', {
      stream: { write: (message) => logger.info(message.trim()) },
    })
  );
  app.use((req, res, next) => {
    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      req.path === '/api/health/live'
    ) {
      return next();
    }
    return rateLimiter(req, res, next);
  });
  app.use('/api', configuredHealthRouter);
  for (const route of additionalRoutes) {
    app.use(route.path, route.router);
  }

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'The requested endpoint does not exist.',
      },
    });
  });

  app.use(errorHandler);

  return app;
}
