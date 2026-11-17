/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Platform payment history + mail config tables
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_payment_history.ts
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
    CREATE TABLE IF NOT EXISTS tblPaymentHistory (
      paymentHistoryID INT AUTO_INCREMENT PRIMARY KEY,
      companyID INT NOT NULL,
      invoice_no VARCHAR(80) DEFAULT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      payment_method VARCHAR(40) DEFAULT NULL,
      payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      paid_at DATETIME DEFAULT NULL,
      reference_no VARCHAR(120) DEFAULT NULL,
      notes TEXT,
      notify_email VARCHAR(150) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_pay_company (companyID),
      KEY idx_pay_status (payment_status),
      CONSTRAINT fk_pay_hist_company
        FOREIGN KEY (companyID) REFERENCES tblCompany(companyID)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tblMailConfig (
      mailConfigID INT AUTO_INCREMENT PRIMARY KEY,
      from_name VARCHAR(120) NOT NULL DEFAULT 'BuildNex ShopOS',
      from_email VARCHAR(150) NOT NULL,
      smtp_host VARCHAR(120) NOT NULL DEFAULT 'smtp.gmail.com',
      smtp_port INT NOT NULL DEFAULT 587,
      smtp_secure TINYINT(1) NOT NULL DEFAULT 0,
      smtp_user VARCHAR(150) NOT NULL,
      smtp_pass VARCHAR(255) DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [rows] = await db.query('SELECT COUNT(*) AS c FROM tblMailConfig');
  if (Number(rows[0].c) === 0) {
    const email = process.env.MAIL_USER || 'buildnexdev@gmail.com';
    await db.query(
      `INSERT INTO tblMailConfig
       (from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, is_active)
       VALUES (?, ?, 'smtp.gmail.com', 587, 0, ?, ?, 1)`,
      ['BuildNex ShopOS', email, email, process.env.MAIL_PASS || null]
    );
    console.log(`Seeded mail config: ${email}`);
  }

  console.log('migrate_payment_history done');
  await db.end();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
