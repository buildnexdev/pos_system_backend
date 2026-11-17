/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Resolve access role (admin/staff/customer) from tblRole mapping
 * Edit Date: 2026-11-14
 */

export type AccessRole = 'admin' | 'staff' | 'customer';

/** SQL join: tblUser u LEFT JOIN tblRole r */
export const USER_ROLE_JOIN = `LEFT JOIN tblRole r ON r.roleID = u.roleID`;

/** Panel users (not customers) */
export const SQL_PANEL_USER = `(r.RoleCode <> 'customer' AND r.Level IS NOT NULL AND r.Level < 90)`;

/** Admin-level roles (full rights) */
export const SQL_ADMIN_USER = `(r.Level <= 2 OR LOWER(r.RoleCode) IN ('admin','owner','admin_manager'))`;

/** Staff-level panel roles (not admin, not customer) */
export const SQL_STAFF_USER = `(${SQL_PANEL_USER} AND NOT (${SQL_ADMIN_USER}))`;

/** Staff page: hide company admin / super admin login accounts */
export const SQL_STAFF_LOGIN_ONLY = `(COALESCE(u.isAdmin, 0) = 0 AND COALESCE(u.isSuperAdmin, 0) = 0)`;

/** Customer roles */
export const SQL_CUSTOMER_USER = `(r.RoleCode = 'customer' OR r.Level >= 90 OR u.roleID IS NULL)`;

/** Company admin = linked company + admin-level role */
export const SQL_COMPANY_ADMIN = `(u.companyID IS NOT NULL AND ${SQL_ADMIN_USER})`;

function accessRoleFromRow(row: {
  RoleCode?: string | null;
  role_code?: string | null;
  Level?: number | null;
  level?: number | null;
  roleID?: number | null;
} | null | undefined): AccessRole {
  if (!row) return 'customer';
  const code = String(row.RoleCode ?? row.role_code ?? '').toLowerCase();
  const level = Number(row.Level ?? row.level ?? 99);
  if (!row.roleID && code === '' && !row.Level && row.Level !== 0) {
    // if only missing join fields but roleID null
  }
  if (code === 'customer' || level >= 90) return 'customer';
  if (code === 'admin' || code === 'owner' || code === 'admin_manager' || level <= 2) return 'admin';
  if (!row.roleID && !code) return 'customer';
  return 'staff';
}

export { accessRoleFromRow };
