import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

export const requireAdminAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const configuredAdminToken = process.env.ADMIN_TOKEN || process.env.HELIX_ADMIN_TOKEN;
  const rawAdminHeader = req.headers['x-admin-token'];
  const authHeader = req.headers.authorization;

  let providedToken: string | undefined;
  if (typeof rawAdminHeader === 'string' && rawAdminHeader.trim()) {
    providedToken = rawAdminHeader.trim();
  } else if (Array.isArray(rawAdminHeader) && rawAdminHeader[0]?.trim()) {
    providedToken = rawAdminHeader[0].trim();
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.slice(7).trim();
  }

  if (!providedToken) {
    res.status(401).json({
      success: false,
      error: 'Admin authentication token is required',
    });
    return;
  }

  if (!configuredAdminToken) {
    res.status(403).json({
      success: false,
      error: 'Admin token is not configured on the server',
    });
    return;
  }

  const tokenHash = crypto.createHash('sha256').update(providedToken).digest();
  const adminHash = crypto.createHash('sha256').update(configuredAdminToken).digest();

  if (!crypto.timingSafeEqual(tokenHash, adminHash)) {
    res.status(403).json({
      success: false,
      error: 'Invalid admin token',
    });
    return;
  }

  next();
};
