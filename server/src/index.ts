import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { standardRateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';

import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { settingsRouter } from './routes/settings';
import { tasksRouter } from './routes/tasks';
import { modelsRouter } from './routes/models';

const app = express();
const PORT = process.env.PORT || 3001;

// Security and utility middleware
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
  morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);
app.use(standardRateLimiter);

// API Routes
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/models', modelsRouter);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    },
  });
});

// Central Error Handler
app.use(errorHandler);

const server = app.listen(PORT, () => {
  logger.info(`[HELIX Server] Running on http://localhost:${PORT}`);
});

// Graceful Shutdown
const shutdown = async () => {
  logger.info('[HELIX Server] Shutting down gracefully...');
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('[HELIX Server] Database disconnected, server terminated.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
