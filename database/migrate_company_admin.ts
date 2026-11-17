/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Link company admins — tblUser.isadmin + companyID
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_company_admin.ts
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

  // isadmin removed — admin is mapped via tblRole (roleID). Keep companyID only.
  if (!(await columnExists(db, 'tblUser', 'companyID'))) {
    await db.query(`ALTER TABLE tblUser ADD COLUMN companyID INT NULL`);
    console.log('Added tblUser.companyID');
  }

  // Best-effort: link legacy admin enum users if column still exists
  if (await columnExists(db, 'tblUser', 'role')) {
    try {
      await db.query(
        `UPDATE tblUser u
         JOIN tblRole r ON r.RoleCode IN ('admin','owner')
         SET u.roleID = r.roleID
         WHERE u.role = 'admin' AND (u.roleID IS NULL OR u.roleID = 0)`
      );
    } catch (_) {}
  }

  console.log('migrate_company_admin done');
  await db.end();
}

run().catch((err) => {
  console.error('migrate_company_admin failed:', err.message);
  process.exit(1);
});
