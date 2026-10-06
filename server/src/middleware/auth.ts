import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../types';

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' },
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user: sbUser }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !sbUser) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Session token is invalid or expired' },
      });
      return;
    }

    // Look up or link the local database user
    let dbUser = await prisma.user.findUnique({
      where: { supabaseId: sbUser.id },
    });

    if (!dbUser && sbUser.email) {
      dbUser = await prisma.user.create({
        data: {
          supabaseId: sbUser.id,
          email: sbUser.email,
          displayName: sbUser.user_metadata?.display_name || null,
        },
      });
    }

    if (!dbUser) {
      res.status(401).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User profile does not exist' },
      });
      return;
    }

    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      supabaseId: dbUser.supabaseId,
    };

    next();
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'AUTH_INTERNAL_ERROR', message: 'Authentication verification failed' },
    });
  }
};
