/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: bank_branch / bank_address for IFSC autofill (supplier, company, staff)
 * Edit Date: 2026-11-20
 *
 * Run: npx tsx database/migrate_bank_address.ts
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

async function addColumn(db: any, table: string, column: string, def: string) {
  if (await columnExists(db, table, column)) {
    console.log(`exists ${table}.${column}`);
    return;
  }
  await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  console.log(`added ${table}.${column}`);
}

async function run() {
  const db: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
  });

  await addColumn(db, 'tblSupplier', 'bank_branch', 'VARCHAR(150) DEFAULT NULL AFTER bank_ifsc');
  await addColumn(db, 'tblSupplier', 'bank_address', 'VARCHAR(255) DEFAULT NULL AFTER bank_branch');

  await addColumn(db, 'tblCompany', 'bank_address', 'VARCHAR(255) DEFAULT NULL AFTER bank_branch');

  await addColumn(db, 'tblStaffProfile', 'bank_address', 'VARCHAR(255) DEFAULT NULL AFTER bank_branch');

  console.log('migrate_bank_address done');
  await db.end();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
