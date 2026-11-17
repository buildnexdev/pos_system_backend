/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Super Admin invoice & agreement documents
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_invoice_agreement.ts
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
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS tblInvoiceAgreement (
      invoiceAgreementID INT AUTO_INCREMENT PRIMARY KEY,
      companyID INT NOT NULL,
      doc_type VARCHAR(30) NOT NULL DEFAULT 'invoice',
      title VARCHAR(200) NOT NULL,
      invoice_no VARCHAR(80) DEFAULT NULL,
      amount DECIMAL(12,2) DEFAULT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      issue_date DATE DEFAULT NULL,
      due_date DATE DEFAULT NULL,
      file_url VARCHAR(500) DEFAULT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_inv_company (companyID),
      KEY idx_inv_type (doc_type),
      CONSTRAINT fk_inv_agr_company
        FOREIGN KEY (companyID) REFERENCES tblCompany(companyID)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('migrate_invoice_agreement done');
  await db.end();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
