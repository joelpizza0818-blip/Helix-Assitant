import dotenv from 'dotenv';
dotenv.config();

import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { createApp } from './app';
import { authRouter } from './routes/auth';
import { settingsRouter } from './routes/settings';
import { tasksRouter } from './routes/tasks';
import { modelsRouter } from './routes/models';
import { updatesRouter } from './routes/updates';
import { communityRouter } from './routes/community';

const PORT = process.env.PORT || 3001;
const app = createApp({
  additionalRoutes: [
    { path: '/api/auth', router: authRouter },
    { path: '/api/settings', router: settingsRouter },
    { path: '/api/tasks', router: tasksRouter },
    { path: '/api/models', router: modelsRouter },
    { path: '/api/updates', router: updatesRouter },
    { path: '/api/community', router: communityRouter },
  ],
});

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
