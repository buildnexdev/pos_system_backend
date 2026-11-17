/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Add isAdmin, isSuperAdmin, branchID flags on tblUser
 * Edit Date: 2026-11-14
 *
 * Login types:
 * - Super Admin: isAdmin=1, isSuperAdmin=1, branchID=0, companyID=0 → Company page only
 * - Company Admin: isAdmin=1, isSuperAdmin=0, branchID=0, companyID>0 → that company
 * - Staff: isAdmin=0, isSuperAdmin=0, branchID any, companyID any → module rights
 *
 * Run: npx tsx database/migrate_user_admin_flags.ts
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function columnExists(db: any, table: string, column: string) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

async function run() {
  const db: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
    multipleStatements: true,
  });

  if (!(await columnExists(db, 'tblUser', 'isAdmin'))) {
    await db.query(`ALTER TABLE tblUser ADD COLUMN isAdmin TINYINT(1) NOT NULL DEFAULT 0`);
    console.log('Added isAdmin');
  }
  if (!(await columnExists(db, 'tblUser', 'isSuperAdmin'))) {
    await db.query(`ALTER TABLE tblUser ADD COLUMN isSuperAdmin TINYINT(1) NOT NULL DEFAULT 0`);
    console.log('Added isSuperAdmin');
  }
  if (!(await columnExists(db, 'tblUser', 'branchID'))) {
    await db.query(`ALTER TABLE tblUser ADD COLUMN branchID INT NOT NULL DEFAULT 0`);
    console.log('Added branchID');
  }

  // Existing Level<=2 / admin RoleCode → company admins (keep their companyID)
  await db.query(`
    UPDATE tblUser u
    LEFT JOIN tblRole r ON r.roleID = u.roleID
    SET u.isAdmin = 1, u.isSuperAdmin = 0, u.branchID = 0
    WHERE u.isSuperAdmin = 0
      AND (
        LOWER(COALESCE(r.RoleCode,'')) IN ('admin','owner','admin_manager')
        OR COALESCE(r.Level, 99) <= 2
      )
  `);

  // Ensure company admins have companyID > 0
  await db.query(`
    UPDATE tblUser u
    SET u.companyID = (
      SELECT c.companyID FROM tblCompany c ORDER BY c.companyID ASC LIMIT 1
    )
    WHERE u.isAdmin = 1 AND u.isSuperAdmin = 0 AND (u.companyID IS NULL OR u.companyID = 0)
  `);

  // Seed / update BuildNex Super Admin
  const email = process.env.SUPERADMIN_EMAIL || 'superadmin@buildnexshopos.com';
  const password = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@123';
  const [existing] = await db.query(`SELECT userID FROM tblUser WHERE email = ? LIMIT 1`, [email]);
  if (!existing.length) {
    const hash = await bcrypt.hash(password, 10);
    // Prefer admin roleID if present
    const [roles] = await db.query(
      `SELECT roleID FROM tblRole
       WHERE RoleCode IN ('admin','owner') OR Level <= 2
       ORDER BY Level ASC LIMIT 1`
    );
    const roleID = roles[0]?.roleID || null;
    await db.query(
      `INSERT INTO tblUser
       (name, email, password, phone, companyID, roleID, isAdmin, isSuperAdmin, branchID, is_active)
       VALUES (?, ?, ?, ?, 0, ?, 1, 1, 0, 1)`,
      ['BuildNex Super Admin', email, hash, '9000000000', roleID]
    );
    console.log(`Created Super Admin: ${email} / ${password}`);
  } else {
    await db.query(
      `UPDATE tblUser SET isAdmin = 1, isSuperAdmin = 1, branchID = 0, companyID = 0, is_active = 1
       WHERE userID = ?`,
      [existing[0].userID]
    );
    console.log(`Updated Super Admin flags: ${email}`);
  }

  // Shop Admin (admin@garments.com) → company admin for company 1
  await db.query(
    `UPDATE tblUser SET isAdmin = 1, isSuperAdmin = 0, branchID = 0
     WHERE email = 'admin@garments.com'`
  );

  console.log('migrate_user_admin_flags done');
  await db.end();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
