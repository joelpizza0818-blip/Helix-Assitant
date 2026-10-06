import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const healthRouter = Router();

healthRouter.get('/health', async (req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'unreachable';
  }

  res.json({
    status: 'healthy',
    service: 'helix-server',
    version: '0.1.0',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});
