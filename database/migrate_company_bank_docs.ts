/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Company bank details columns + tblCompanyDocument
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_company_bank_docs.ts
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
    multipleStatements: true,
  });

  const bankCols: Array<[string, string]> = [
    ['bank_name', 'VARCHAR(150) DEFAULT NULL'],
    ['account_holder', 'VARCHAR(150) DEFAULT NULL'],
    ['account_number', 'VARCHAR(60) DEFAULT NULL'],
    ['ifsc_code', 'VARCHAR(30) DEFAULT NULL'],
    ['bank_branch', 'VARCHAR(150) DEFAULT NULL'],
  ];

  for (const [col, def] of bankCols) {
    if (!(await columnExists(db, 'tblCompany', col))) {
      await db.query(`ALTER TABLE tblCompany ADD COLUMN ${col} ${def}`);
      console.log(`Added tblCompany.${col}`);
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS tblCompanyDocument (
      companyDocumentID INT AUTO_INCREMENT PRIMARY KEY,
      companyID INT NOT NULL,
      doc_type VARCHAR(80) DEFAULT NULL,
      doc_name VARCHAR(180) DEFAULT NULL,
      file_url VARCHAR(500) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_company_doc (companyID),
      CONSTRAINT fk_company_doc_company
        FOREIGN KEY (companyID) REFERENCES tblCompany(companyID)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('migrate_company_bank_docs done');
  await db.end();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
