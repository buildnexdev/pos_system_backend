/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Resolve tblRole.roleID for system access roles (prefer company, else global)
 * Edit Date: 2026-11-14
 */

import db from '../config/db';
import type { AccessRole } from '../config/userRole';

const cache: Record<string, number> = {};

async function getRoleId(accessRole: AccessRole, companyID?: number | null): Promise<number> {
  const cid = Number(companyID) > 0 ? Number(companyID) : 0;
  const cacheKey = `${accessRole}:${cid}`;
  if (cache[cacheKey]) return cache[cacheKey];

  let codes: string[] = ['customer'];
  if (accessRole === 'admin') {
    codes = ['admin', 'owner', 'admin_manager'];
  } else if (accessRole === 'staff') {
    codes = ['staff', 'staff_viewer'];
  }

  // Also match company-seeded codes like owner_c1
  const likePatterns = codes.map((c) => `${c}_c%`);
  const placeholders = codes.map(() => '?').join(',');
  const likeSql = likePatterns.map(() => 'RoleCode LIKE ?').join(' OR ');

  const [rows]: any = await db.query(
    `SELECT roleID FROM tblRole
     WHERE IsActive = 1
       AND companyID IN (0, ?)
       AND (RoleCode IN (${placeholders}) OR ${likeSql})
     ORDER BY
       CASE WHEN companyID = ? THEN 0 ELSE 1 END,
       Level ASC
     LIMIT 1`,
    [cid, ...codes, ...likePatterns, cid]
  );

  if (!rows.length) {
    throw new Error(`System role not found for ${accessRole}`);
  }

  cache[cacheKey] = Number(rows[0].roleID);
  return cache[cacheKey];
}

export { getRoleId };
