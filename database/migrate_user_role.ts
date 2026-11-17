/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_user_role
 * Edit Date: 2026-11-12
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const db: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
    multipleStatements: true,
  });

  const [cols] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role_id'`
  );

  if (!cols.length) {
    await db.query(`ALTER TABLE users ADD COLUMN role_id INT NULL AFTER role`);
    try {
      await db.query(
        `ALTER TABLE users
         ADD CONSTRAINT fk_users_tblrole
         FOREIGN KEY (role_id) REFERENCES tblRole(RoleId)
         ON DELETE SET NULL`
      );
    } catch (err) {
      console.warn('FK skipped:', err.message);
    }
  }

  // Default map system role -> tblRole level
  await db.query(`
    UPDATE users u
    LEFT JOIN tblRole r ON r.Level = 1 AND r.IsDefault = 1
    SET u.role_id = r.RoleId
    WHERE u.role = 'admin' AND u.role_id IS NULL
  `);

  await db.query(`
    UPDATE users u
    LEFT JOIN tblRole r ON r.Level = 7 AND r.IsDefault = 1
    SET u.role_id = r.RoleId
    WHERE u.role = 'staff' AND u.role_id IS NULL
  `);

  console.log('users.role_id ready for Assign User Right.');
  await db.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
