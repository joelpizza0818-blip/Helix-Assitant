import { NextFunction, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import {
  isCommunityModerator,
  parseCommunitySubmission,
} from './communityValidation';

const ReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().trim().max(1000).optional(),
}).strict();

function requireModerator(req: AuthenticatedRequest, res: Response): boolean {
  if (isCommunityModerator(req.user?.email ?? null)) return true;
  res.status(403).json({
    success: false,
    error: {
      code: 'COMMUNITY_MODERATOR_REQUIRED',
      message: 'Community moderation is not enabled for this account.',
    },
  });
  return false;
}

function forwardError(next: NextFunction, error: unknown): void {
  next(error);
}

export const communityRouter = Router();

communityRouter.get('/', async (req, res: Response, next: NextFunction) => {
  try {
    const typeValue = req.query.type;
    const type = typeValue === undefined
      ? undefined
      : z.enum(['plugin', 'skill', 'agent']).safeParse(typeValue);
    if (type && !type.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_COMMUNITY_TYPE', message: 'Unknown Community item type.' },
      });
      return;
    }

    const items = await prisma.communityItem.findMany({
      where: {
        status: 'APPROVED',
        ...(type && type.success ? { type: type.data } : {}),
      },
      select: {
        id: true,
        type: true,
        name: true,
        description: true,
        manifest: true,
        status: true,
        createdAt: true,
        creator: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: items });
  } catch (error) {
    forwardError(next, error);
  }
});

communityRouter.get(
  '/mine',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const items = await prisma.communityItem.findMany({
        where: { creatorId: req.user!.id },
        select: {
          id: true,
          type: true,
          name: true,
          description: true,
          manifest: true,
          status: true,
          reviewNote: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json({ success: true, data: items });
    } catch (error) {
      forwardError(next, error);
    }
  },
);

communityRouter.post(
  '/',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const submission = parseCommunitySubmission(req.body);
    if (!submission) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_COMMUNITY_SUBMISSION',
          message: 'Provide a valid plugin, skill, or agent manifest.',
        },
      });
      return;
    }
    try {
      const item = await prisma.communityItem.create({
        data: {
          creatorId: req.user!.id,
          ...submission,
          status: 'PENDING',
        },
        select: {
          id: true,
          type: true,
          name: true,
          description: true,
          manifest: true,
          status: true,
          createdAt: true,
        },
      });
      res.status(201).json({ success: true, data: item });
    } catch (error) {
      forwardError(next, error);
    }
  },
);

communityRouter.get(
  '/moderation',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!requireModerator(req, res)) return;
    try {
      const items = await prisma.communityItem.findMany({
        where: { status: 'PENDING' },
        select: {
          id: true,
          type: true,
          name: true,
          description: true,
          manifest: true,
          status: true,
          createdAt: true,
          creator: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      res.json({ success: true, data: items });
    } catch (error) {
      forwardError(next, error);
    }
  },
);

communityRouter.post(
  '/:id/review',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!requireModerator(req, res)) return;
    const id = z.string().uuid().safeParse(req.params.id);
    const review = ReviewSchema.safeParse(req.body);
    if (!id.success || !review.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_COMMUNITY_REVIEW', message: 'The review request is invalid.' },
      });
      return;
    }
    try {
      const updated = await prisma.communityItem.updateMany({
        where: { id: id.data, status: 'PENDING' },
        data: {
          status: review.data.status,
          reviewNote: review.data.status === 'REJECTED'
            ? review.data.reviewNote ?? null
            : null,
        },
      });
      if (updated.count === 0) {
        res.status(404).json({
          success: false,
          error: {
            code: 'COMMUNITY_ITEM_NOT_PENDING',
            message: 'This Community item is missing or has already been reviewed.',
          },
        });
        return;
      }
      const item = await prisma.communityItem.findUnique({
        where: { id: id.data },
        select: { id: true, status: true, reviewNote: true },
      });
      res.json({ success: true, data: item });
    } catch (error) {
      forwardError(next, error);
    }
  },
);
