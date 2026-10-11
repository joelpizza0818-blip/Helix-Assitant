import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

type DatabaseProbe = () => Promise<unknown>;

export function createHealthRouter(
  databaseProbe: DatabaseProbe = () => prisma.$queryRaw`SELECT 1`
) {
  const router = Router();

  router.get('/health/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      service: 'helix-server',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  const readinessHandler = async (_req: Request, res: Response) => {
    let dbStatus = 'connected';
    try {
      await databaseProbe();
    } catch {
      dbStatus = 'unreachable';
    }

    const healthy = dbStatus === 'connected';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      service: 'helix-server',
      version: '0.1.0',
      database: dbStatus,
      timestamp: new Date().toISOString(),
    });
  };

  router.get('/health', readinessHandler);
  router.get('/health/ready', readinessHandler);

  return router;
}

export const healthRouter = createHealthRouter();
