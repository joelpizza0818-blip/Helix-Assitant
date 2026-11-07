import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  supabaseId: string;
  githubUserId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}
