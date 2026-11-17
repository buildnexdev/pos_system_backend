/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Single-DB tenancy + login-type helpers (Super / Company Admin / Staff)
 * Edit Date: 2026-11-14
 */

import type { AuthUser } from '../types/express';

export class CompanyScopeError extends Error {
  status: number;
  constructor(message = 'Company context required', status = 403) {
    super(message);
    this.status = status;
  }
}

function flagOn(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

/** Super Admin: isAdmin=1, isSuperAdmin=1, companyID=0, branchID=0 → Company page only */
export function isSuperAdmin(user?: AuthUser | null): boolean {
  if (!user) return false;
  return flagOn(user.isSuperAdmin) && flagOn(user.isAdmin);
}

/** Company Admin: isAdmin=1, isSuperAdmin=0, companyID>0 */
export function isCompanyAdmin(user?: AuthUser | null): boolean {
  if (!user) return false;
  if (isSuperAdmin(user)) return false;
  return flagOn(user.isAdmin);
}

export function getBranchId(user?: AuthUser | null): number {
  const n = Number(user?.branchID ?? user?.branchId ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Resolve companyID from JWT. Super Admin has companyID 0 → returns null. */
export function getCompanyId(user?: AuthUser | null): number | null {
  if (!user) return null;
  if (isSuperAdmin(user)) return null;
  const raw = user.companyID ?? user.companyId ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function requireCompanyId(user?: AuthUser | null): number {
  if (isSuperAdmin(user)) {
    throw new CompanyScopeError('Super Admin cannot access company-scoped data APIs', 403);
  }
  const id = getCompanyId(user);
  if (!id) throw new CompanyScopeError('Company context required', 403);
  return id;
}

export function sqlCompanyEq(alias = ''): string {
  const col = alias ? `${alias}.companyID` : 'companyID';
  return `${col} = :companyID`;
}

export function withCompanyParams(params: Record<string, unknown>, companyID: number) {
  return { ...params, companyID };
}

/** Only Super Admin manages all companies */
export function canManageAllCompanies(user?: AuthUser | null): boolean {
  return isSuperAdmin(user);
}
