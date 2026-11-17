/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Express Request augmentation for JWT auth user payload
 * Edit Date: 2026-11-12
 */

import 'express-serve-static-core';

export interface AuthUser {
  id: number;
  email?: string;
  role?: string;
  name?: string;
  companyID?: number | null;
  companyId?: number | null;
  isAdmin?: number | boolean;
  isSuperAdmin?: number | boolean;
  branchID?: number | null;
  branchId?: number | null;
  /** Active login session id — only one device at a time */
  sid?: string;
  /** @deprecated prefer companyID — kept for support module compatibility */
  tenant_id?: number;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
