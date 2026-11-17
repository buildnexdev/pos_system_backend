/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Create tblCompany for organization master CRUD
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_company.ts
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS tblCompany (
      companyID INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(40) DEFAULT NULL,
      legal_name VARCHAR(180) DEFAULT NULL,
      email VARCHAR(150) DEFAULT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      alternate_phone VARCHAR(30) DEFAULT NULL,
      website VARCHAR(180) DEFAULT NULL,
      address VARCHAR(255) DEFAULT NULL,
      city VARCHAR(100) DEFAULT NULL,
      state VARCHAR(100) DEFAULT NULL,
      pincode VARCHAR(20) DEFAULT NULL,
      country VARCHAR(80) DEFAULT 'India',
      gstin VARCHAR(30) DEFAULT NULL,
      pan VARCHAR(20) DEFAULT NULL,
      cin VARCHAR(40) DEFAULT NULL,
      logo_url VARCHAR(255) DEFAULT NULL,
      notes TEXT,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_company_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const [rows] = await db.query('SELECT COUNT(*) AS c FROM tblCompany');
  if (Number(rows[0].c) === 0) {
    await db.query(
      `INSERT INTO tblCompany
       (name, code, legal_name, email, phone, website, address, city, state, pincode, country, notes, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        'BuildNex ShopOS',
        'BNX-HQ',
        'BuildNex ShopOS Pvt Ltd',
        'admin@buildnexshopos.com',
        '9876543210',
        'https://buildnexshopos.com',
        '12 Fashion Street',
        'Chennai',
        'Tamil Nadu',
        '600001',
        'India',
        'Default company profile',
      ]
    );
    console.log('Seeded default company');
  }

  console.log('tblCompany ready');
  await db.end();
}

run().catch((err) => {
  console.error('migrate_company failed:', err.message);
  process.exit(1);
});
