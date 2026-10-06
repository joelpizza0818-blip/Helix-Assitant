import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  supabaseId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}
