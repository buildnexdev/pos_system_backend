/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: OTP + company registration request tables for login flows
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_auth_otp.ts
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function tableExists(db: any, table: string) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
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

  if (!(await tableExists(db, 'tblAuthOtp'))) {
    await db.query(`
      CREATE TABLE tblAuthOtp (
        authOtpID INT AUTO_INCREMENT PRIMARY KEY,
        identifier VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL,
        purpose VARCHAR(40) NOT NULL DEFAULT 'reset',
        otp_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_otp_email_purpose (email, purpose),
        INDEX idx_otp_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created tblAuthOtp');
  }

  if (!(await tableExists(db, 'tblCompanyRequest'))) {
    await db.query(`
      CREATE TABLE tblCompanyRequest (
        companyRequestID INT AUTO_INCREMENT PRIMARY KEY,
        company_name VARCHAR(200) NOT NULL,
        contact_name VARCHAR(120) NOT NULL,
        email VARCHAR(150) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        city VARCHAR(100) DEFAULT NULL,
        message TEXT DEFAULT NULL,
        status ENUM('pending','contacted','approved','rejected') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created tblCompanyRequest');
  }

  console.log('Auth OTP / company request migration done');
  await db.end();
}

run().catch((err) => {
  console.error('migrate_auth_otp failed:', err.message);
  process.exit(1);
});
