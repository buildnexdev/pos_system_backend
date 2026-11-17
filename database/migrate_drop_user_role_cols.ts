/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Drop tblUser.role + isadmin — role comes only from tblRole via roleID
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_drop_user_role_cols.ts
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';

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

  // Ensure customer system role exists
  await db.query(
    `INSERT INTO tblRole (RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive)
     VALUES ('Customer', 'customer', 99, 'Storefront customer account', '#64748b', 1, 1)
     ON DUPLICATE KEY UPDATE
       RoleName = VALUES(RoleName),
       Level = VALUES(Level),
       IsDefault = 1,
       IsActive = 1`
  );

  // Ensure canonical admin role code exists (alias for Owner)
  await db.query(
    `INSERT INTO tblRole (RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive)
     VALUES ('Admin', 'admin', 1, 'Company / system admin', '#7c3aed', 1, 1)
     ON DUPLICATE KEY UPDATE
       RoleName = VALUES(RoleName),
       Level = VALUES(Level),
       IsActive = 1`
  );

  // Ensure staff role code
  await db.query(
    `INSERT INTO tblRole (RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive)
     VALUES ('Staff', 'staff', 7, 'Panel staff account', '#64748b', 1, 1)
     ON DUPLICATE KEY UPDATE
       RoleName = VALUES(RoleName),
       Level = VALUES(Level),
       IsActive = 1`
  );

  const [[adminRole]] = await db.query(
    `SELECT roleID FROM tblRole WHERE RoleCode IN ('admin','owner') ORDER BY FIELD(RoleCode,'admin','owner') LIMIT 1`
  );
  const [[staffRole]] = await db.query(
    `SELECT roleID FROM tblRole WHERE RoleCode IN ('staff','staff_viewer') ORDER BY FIELD(RoleCode,'staff','staff_viewer') LIMIT 1`
  );
  const [[customerRole]] = await db.query(
    `SELECT roleID FROM tblRole WHERE RoleCode = 'customer' LIMIT 1`
  );

  if (!adminRole || !staffRole || !customerRole) {
    throw new Error('Failed to resolve system role IDs');
  }

  console.log('role IDs', {
    admin: adminRole.roleID,
    staff: staffRole.roleID,
    customer: customerRole.roleID,
  });

  if (await columnExists(db, 'tblUser', 'role')) {
    await db.query(
      `UPDATE tblUser SET roleID = ? WHERE role = 'admin' AND (roleID IS NULL OR roleID = 0)`,
      [adminRole.roleID]
    );
    await db.query(
      `UPDATE tblUser SET roleID = ? WHERE role = 'staff' AND (roleID IS NULL OR roleID = 0)`,
      [staffRole.roleID]
    );
    await db.query(
      `UPDATE tblUser SET roleID = ? WHERE role = 'customer' AND (roleID IS NULL OR roleID = 0)`,
      [customerRole.roleID]
    );
    // Any leftover nulls → customer
    await db.query(
      `UPDATE tblUser SET roleID = ? WHERE roleID IS NULL OR roleID = 0`,
      [customerRole.roleID]
    );
  } else {
    await db.query(
      `UPDATE tblUser SET roleID = ? WHERE roleID IS NULL OR roleID = 0`,
      [customerRole.roleID]
    );
  }

  // Prefer isadmin=1 users to admin roleID
  if (await columnExists(db, 'tblUser', 'isadmin')) {
    await db.query(
      `UPDATE tblUser SET roleID = ? WHERE isadmin = 1`,
      [adminRole.roleID]
    );
  }

  if (await columnExists(db, 'tblUser', 'isadmin')) {
    await db.query(`ALTER TABLE tblUser DROP COLUMN isadmin`);
    console.log('Dropped tblUser.isadmin');
  }

  if (await columnExists(db, 'tblUser', 'role')) {
    await db.query(`ALTER TABLE tblUser DROP COLUMN role`);
    console.log('Dropped tblUser.role');
  }

  if (await columnExists(db, 'tblUser', 'isSuperAdmin')) {
    await db.query(`ALTER TABLE tblUser DROP COLUMN isSuperAdmin`);
    console.log('Dropped tblUser.isSuperAdmin');
  }

  console.log('tblUser now uses roleID → tblRole only');
  await db.end();
}

run().catch((err) => {
  console.error('migrate_drop_user_role_cols failed:', err.message);
  process.exit(1);
});
