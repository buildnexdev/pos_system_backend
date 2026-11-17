/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Add session_token + password_changed_at for single-login and 10-day password policy
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_auth_session.ts
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
  });

  if (!(await columnExists(db, 'tblUser', 'session_token'))) {
    await db.query(
      `ALTER TABLE tblUser
       ADD COLUMN session_token VARCHAR(64) NULL DEFAULT NULL AFTER password`
    );
    console.log('Added tblUser.session_token');
  }

  if (!(await columnExists(db, 'tblUser', 'password_changed_at'))) {
    await db.query(
      `ALTER TABLE tblUser
       ADD COLUMN password_changed_at DATETIME NULL DEFAULT NULL AFTER session_token`
    );
    console.log('Added tblUser.password_changed_at');
  }

  await db.query(
    `UPDATE tblUser
     SET password_changed_at = COALESCE(password_changed_at, created_at, NOW())
     WHERE password_changed_at IS NULL`
  );
  console.log('Backfilled password_changed_at');

  console.log('Auth session migration done');
  await db.end();
}

run().catch((err) => {
  console.error('migrate_auth_session failed:', err.message);
  process.exit(1);
});
