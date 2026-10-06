import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthenticatedRequest } from '../types';

export const tasksRouter = Router();

const CreateTaskSchema = z.object({
  body: z.object({
    description: z.string().min(1),
    priority: z.number().int().min(1).max(10).optional().default(5),
    model: z.string().optional(),
    provider: z.string().optional(),
  }),
});

// GET /api/tasks - List all user tasks
tasksRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const status = req.query.status as string | undefined;

  const tasks = await prisma.task.findMany({
    where: {
      userId: req.user!.id,
      ...(status && { status }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({
    success: true,
    data: tasks,
  });
});

// POST /api/tasks - Create or sync a new task
tasksRouter.post(
  '/',
  requireAuth,
  validate(CreateTaskSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const { description, priority, model, provider } = req.body;

    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        description,
        priority,
        model,
        provider,
        status: 'queued',
      },
    });

    res.status(201).json({
      success: true,
      data: task,
    });
  }
);

// GET /api/tasks/:id - Get specific task details with logs
tasksRouter.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const task = await prisma.task.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id,
    },
    include: {
      logs: { orderBy: { timestamp: 'asc' } },
    },
  });

  if (!task) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task not found' },
    });
    return;
  }

  res.json({
    success: true,
    data: task,
  });
});

// DELETE /api/tasks/:id - Cancel or delete a task
tasksRouter.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const task = await prisma.task.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id,
    },
  });

  if (!task) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task not found' },
    });
    return;
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: 'cancelled' },
  });

  res.json({
    success: true,
    data: updated,
  });
});
