/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Extra customer profile columns on tblUser
 * Edit Date: 2026-11-20
 *
 * Run: npx tsx database/migrate_customer_details.ts
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const COLUMNS: [string, string][] = [
  ['gender', "VARCHAR(20) DEFAULT NULL AFTER phone"],
  ['whatsapp', "VARCHAR(20) DEFAULT NULL AFTER gender"],
  ['landmark', "VARCHAR(180) DEFAULT NULL AFTER address"],
  ['gstin', "VARCHAR(30) DEFAULT NULL AFTER pincode"],
  ['pan', "VARCHAR(20) DEFAULT NULL AFTER gstin"],
  ['date_of_birth', "DATE DEFAULT NULL AFTER pan"],
  ['notes', "VARCHAR(500) DEFAULT NULL AFTER date_of_birth"],
];

async function columnExists(db: any, table: string, column: string) {
  const [rows] = await db.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return rows.length > 0;
}

async function run() {
  const db: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
  });

  for (const [name, def] of COLUMNS) {
    if (await columnExists(db, 'tblUser', name)) {
      console.log('exists', name);
      continue;
    }
    await db.query(`ALTER TABLE tblUser ADD COLUMN ${name} ${def}`);
    console.log('added', name);
  }

  await db.end();
  console.log('migrate_customer_details done');
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
