/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: JWT auth with Super Admin / Company Admin / Staff rights
 * Edit Date: 2026-11-14
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import db from '../config/db';
import { companyAdminRights, companyOnlyRights, SUPER_ADMIN_MODULE_KEYS } from '../config/modules';
import type { AuthUser } from '../types/express';
import { getCompanyId, isSuperAdmin, isCompanyAdmin } from '../utils/companyScope';

function flagOn(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

function normalizeUser(decoded: AuthUser): AuthUser {
  const isSuper = flagOn(decoded.isSuperAdmin);
  const isAdmin = flagOn(decoded.isAdmin) || isSuper;
  const companyID = isSuper ? 0 : getCompanyId(decoded) ?? (Number(decoded.companyID) > 0 ? Number(decoded.companyID) : 0);
  const branchID = Number(decoded.branchID ?? decoded.branchId ?? 0) || 0;
  return {
    ...decoded,
    isAdmin: isAdmin ? 1 : 0,
    isSuperAdmin: isSuper ? 1 : 0,
    branchID,
    companyID,
    tenant_id: companyID || undefined,
    role: isSuper || isAdmin ? 'admin' : decoded.role,
  };
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required', code: 'NO_TOKEN' });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'garments_shop_jwt_secret_change_me'
    ) as AuthUser;
    const user = normalizeUser(decoded);

    // Single-session: token sid must match the active DB session
    const sid = String(decoded.sid || '');
    if (!sid) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.',
        code: 'SESSION_REQUIRED',
      });
    }
    const [rows] = await db.query(
      'SELECT session_token, is_active FROM tblUser WHERE userID = :id LIMIT 1',
      { id: user.id }
    );
    if (!rows.length || Number(rows[0].is_active) === 0) {
      return res.status(401).json({
        success: false,
        message: 'Account inactive or not found',
        code: 'ACCOUNT_INACTIVE',
      });
    }
    if (String(rows[0].session_token || '') !== sid) {
      return res.status(401).json({
        success: false,
        message: 'Logged in on another device. This session has ended.',
        code: 'SESSION_REPLACED',
      });
    }

    req.user = { ...user, sid };
    next();
  } catch (err: any) {
    const expired = err?.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      message: expired
        ? 'Login expired after 24 hours. Please login again.'
        : 'Invalid or expired token',
      code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    });
  }
}

const requireCompany: RequestHandler = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (isSuperAdmin(req.user)) return next();
  if (!getCompanyId(req.user)) {
    return res.status(403).json({ success: false, message: 'Company context required' });
  }
  if (req.headers['x-company-id'] || req.headers['x-companyid']) {
    return res.status(400).json({ success: false, message: 'Company override headers are not allowed' });
  }
  next();
};

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (!isSuperAdmin(req.user) && !isCompanyAdmin(req.user) && req.user.role !== 'admin')) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
}

function requirePanelUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(403).json({ success: false, message: 'Panel access required' });
  }
  if (isSuperAdmin(req.user) || isCompanyAdmin(req.user)) return next();
  if (!['admin', 'staff'].includes(String(req.user.role || ''))) {
    return res.status(403).json({ success: false, message: 'Panel access required' });
  }
  if (!getCompanyId(req.user)) {
    return res.status(403).json({ success: false, message: 'Company context required' });
  }
  next();
}

function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.user = normalizeUser(
      jwt.verify(
        token,
        process.env.JWT_SECRET || 'garments_shop_jwt_secret_change_me'
      ) as AuthUser
    );
  } catch (err) {
    // ignore
  }
  next();
}

async function getUserRights(user?: AuthUser | null) {
  if (!user) return [];
  if (isSuperAdmin(user)) return companyOnlyRights();
  // Company Admin: all modules except Company page
  if (isCompanyAdmin(user) || user.role === 'admin') return companyAdminRights();
  const [rows] = await db.query(
    'SELECT module_key, can_view, can_create, can_edit, can_delete FROM tblUserRight WHERE userID = :userId',
    { userId: user.id }
  );
  return rows;
}

const RIGHT_FIELD = {
  view: 'can_view',
  create: 'can_create',
  edit: 'can_edit',
  delete: 'can_delete',
} as const;

async function staffHasRight(
  user: AuthUser,
  moduleKey: string,
  action: 'view' | 'create' | 'edit' | 'delete'
) {
  const field = RIGHT_FIELD[action] || 'can_view';
  const [rows] = await db.query(
    `SELECT ${field} AS allowed FROM tblUserRight WHERE userID = :userId AND module_key = :moduleKey LIMIT 1`,
    { userId: user.id, moduleKey }
  );
  return Boolean(rows.length && rows[0].allowed);
}

function requireRight(moduleKey: string, action: 'view' | 'create' | 'edit' | 'delete' = 'view'): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      if (req.headers['x-company-id'] || req.headers['x-companyid']) {
        return res.status(400).json({ success: false, message: 'Company override headers are not allowed' });
      }

      // Super Admin: platform modules only
      if (isSuperAdmin(req.user)) {
        if (!SUPER_ADMIN_MODULE_KEYS.has(moduleKey)) {
          return res.status(403).json({ success: false, message: 'Super Admin access limited to platform pages' });
        }
        return next();
      }

      // Super Admin–only modules
      if (SUPER_ADMIN_MODULE_KEYS.has(moduleKey) && moduleKey !== 'support') {
        return res.status(403).json({ success: false, message: 'Only Super Admin can access this module' });
      }

      if (!getCompanyId(req.user)) {
        return res.status(403).json({ success: false, message: 'Company context required' });
      }

      // Company Admin: full access within company (no Company page)
      if (isCompanyAdmin(req.user) || req.user.role === 'admin') return next();

      if (req.user.role !== 'staff') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      if (!(await staffHasRight(req.user, moduleKey, action))) {
        return res.status(403).json({ success: false, message: `No ${action} right for ${moduleKey}` });
      }
      next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Rights check failed' });
    }
  };
}

/** Allow if staff has the action on any of the given modules (e.g. catalog or product). */
function requireAnyRight(
  moduleKeys: string[],
  action: 'view' | 'create' | 'edit' | 'delete' = 'view'
): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      if (req.headers['x-company-id'] || req.headers['x-companyid']) {
        return res.status(400).json({ success: false, message: 'Company override headers are not allowed' });
      }

      if (isSuperAdmin(req.user)) {
        if (!moduleKeys.some((k) => SUPER_ADMIN_MODULE_KEYS.has(k))) {
          return res.status(403).json({ success: false, message: 'Super Admin access limited to platform pages' });
        }
        return next();
      }

      if (moduleKeys.every((k) => SUPER_ADMIN_MODULE_KEYS.has(k) && k !== 'support')) {
        return res.status(403).json({ success: false, message: 'Only Super Admin can access this module' });
      }

      if (!getCompanyId(req.user)) {
        return res.status(403).json({ success: false, message: 'Company context required' });
      }

      if (isCompanyAdmin(req.user) || req.user.role === 'admin') return next();

      if (req.user.role !== 'staff') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      for (const moduleKey of moduleKeys) {
        if (await staffHasRight(req.user, moduleKey, action)) return next();
      }
      return res.status(403).json({
        success: false,
        message: `No ${action} right for ${moduleKeys.join(' / ')}`,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Rights check failed' });
    }
  };
}

export {
  requireAuth,
  requireAdmin,
  requirePanelUser,
  requireCompany,
  optionalAuth,
  requireRight,
  requireAnyRight,
  getUserRights,
};
