/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_supplier_details
 * Edit Date: 2026-11-12
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const COLUMNS = [
  ['code', "VARCHAR(40) DEFAULT NULL AFTER name"],
  ['alternate_phone', "VARCHAR(30) DEFAULT NULL AFTER phone"],
  ['city', "VARCHAR(100) DEFAULT NULL AFTER address"],
  ['state', "VARCHAR(100) DEFAULT NULL AFTER city"],
  ['pincode', "VARCHAR(20) DEFAULT NULL AFTER state"],
  ['country', "VARCHAR(80) DEFAULT 'India' AFTER pincode"],
  ['gstin', "VARCHAR(30) DEFAULT NULL AFTER country"],
  ['pan', "VARCHAR(20) DEFAULT NULL AFTER gstin"],
  ['company_type', "VARCHAR(60) DEFAULT NULL AFTER pan"],
  ['payment_terms', "VARCHAR(120) DEFAULT NULL AFTER company_type"],
  ['credit_days', "INT DEFAULT 0 AFTER payment_terms"],
  ['credit_limit', "DECIMAL(12,2) DEFAULT 0 AFTER credit_days"],
  ['bank_name', "VARCHAR(120) DEFAULT NULL AFTER credit_limit"],
  ['bank_account_name', "VARCHAR(150) DEFAULT NULL AFTER bank_name"],
  ['bank_account_no', "VARCHAR(60) DEFAULT NULL AFTER bank_account_name"],
  ['bank_ifsc', "VARCHAR(30) DEFAULT NULL AFTER bank_account_no"],
  ['website', "VARCHAR(180) DEFAULT NULL AFTER bank_ifsc"],
];

async function run() {
  const c: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
  });

  for (const [name, def] of COLUMNS) {
    const [rows] = await c.query('SHOW COLUMNS FROM suppliers LIKE ?', [name]);
    if (!rows.length) {
      await c.query(`ALTER TABLE suppliers ADD COLUMN ${name} ${def}`);
      console.log('added', name);
    } else {
      console.log('exists', name);
    }
  }

  await c.query(`
    UPDATE suppliers SET
      code = COALESCE(code, CONCAT('SUP-', LPAD(id, 3, '0'))),
      city = COALESCE(NULLIF(city, ''), CASE
        WHEN address LIKE '%Tirupur%' THEN 'Tirupur'
        WHEN address LIKE '%Bangalore%' THEN 'Bangalore'
        WHEN address LIKE '%Surat%' THEN 'Surat'
        ELSE city END),
      state = COALESCE(NULLIF(state, ''), CASE
        WHEN address LIKE '%Tirupur%' THEN 'Tamil Nadu'
        WHEN address LIKE '%Bangalore%' THEN 'Karnataka'
        WHEN address LIKE '%Surat%' THEN 'Gujarat'
        ELSE state END),
      country = COALESCE(country, 'India'),
      company_type = COALESCE(company_type, 'Wholesaler'),
      payment_terms = COALESCE(payment_terms, 'Net 30')
    WHERE code IS NULL OR city IS NULL OR company_type IS NULL
  `);

  await c.end();
  console.log('done');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
