/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Scope tblRole by companyID (0 = global/system, >0 = company roles)
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_role_company.ts
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

async function indexExists(db: any, table: string, indexName: string) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
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

  if (!(await columnExists(db, 'tblRole', 'companyID'))) {
    await db.query(
      `ALTER TABLE tblRole ADD COLUMN companyID INT NOT NULL DEFAULT 0 AFTER roleID`
    );
    console.log('Added tblRole.companyID');
  }

  // Drop old unique on RoleCode alone if present (name varies)
  const [uniq]: any = await db.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblRole'
       AND NON_UNIQUE = 0 AND COLUMN_NAME = 'RoleCode'
       AND INDEX_NAME <> 'PRIMARY'`
  );
  for (const row of uniq) {
    try {
      await db.query(`ALTER TABLE tblRole DROP INDEX \`${row.INDEX_NAME}\``);
      console.log(`Dropped unique index ${row.INDEX_NAME}`);
    } catch (e: any) {
      console.warn('drop index skip:', e.message);
    }
  }

  if (!(await indexExists(db, 'tblRole', 'uniq_role_company_code'))) {
    await db.query(
      `ALTER TABLE tblRole ADD UNIQUE KEY uniq_role_company_code (companyID, RoleCode)`
    );
    console.log('Added uniq_role_company_code (companyID, RoleCode)');
  }

  if (!(await indexExists(db, 'tblRole', 'idx_role_company'))) {
    await db.query(`ALTER TABLE tblRole ADD KEY idx_role_company (companyID)`);
    console.log('Added idx_role_company');
  }

  // Existing rows stay global (companyID = 0)
  await db.query(`UPDATE tblRole SET companyID = 0 WHERE companyID IS NULL`);

  console.log('migrate_role_company done');
  await db.end();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
