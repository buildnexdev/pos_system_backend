/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Add companyID to tenant-root tables and backfill to default company
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_company_scope.ts
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TABLES = [
  'tblCategory',
  'tblProductType',
  'tblSupplier',
  'tblProduct',
  'tblBranch',
  'tblWarehouse',
  'tblInventory',
  'tblStockMovement',
  'tblOrder',
  'tblBilling',
  'tblPosPayment',
  'tblFinanceEntry',
  'tblPaymentGateway',
  'tblDropshipOrder',
];

async function columnExists(db: any, table: string, column: string) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

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
    multipleStatements: true,
  });

  // Ensure default company
  if (!(await tableExists(db, 'tblCompany'))) {
    throw new Error('tblCompany missing — run db:migrate-company first');
  }

  const [companies] = await db.query('SELECT companyID FROM tblCompany ORDER BY companyID ASC LIMIT 1');
  if (!companies.length) {
    await db.query(
      `INSERT INTO tblCompany (name, code, email, phone, is_active)
       VALUES ('BuildNex ShopOS', 'BNX-HQ', 'admin@buildnexshopos.com', '9876543210', 1)`
    );
  }
  const [[first]] = await db.query('SELECT companyID FROM tblCompany ORDER BY companyID ASC LIMIT 1');
  const defaultCompanyID = Number(first.companyID);
  console.log('Default companyID:', defaultCompanyID);

  if (!(await columnExists(db, 'tblUser', 'companyID'))) {
    await db.query('ALTER TABLE tblUser ADD COLUMN companyID INT NULL');
    console.log('Added tblUser.companyID');
  }
  await db.query('UPDATE tblUser SET companyID = ? WHERE companyID IS NULL OR companyID = 0', [
    defaultCompanyID,
  ]);

  for (const table of TABLES) {
    if (!(await tableExists(db, table))) {
      console.log('Skip missing table', table);
      continue;
    }
    if (!(await columnExists(db, table, 'companyID'))) {
      await db.query(`ALTER TABLE \`${table}\` ADD COLUMN companyID INT NULL`);
      console.log('Added', table + '.companyID');
    }
    await db.query(`UPDATE \`${table}\` SET companyID = ? WHERE companyID IS NULL OR companyID = 0`, [
      defaultCompanyID,
    ]);
    // Index for filters
    try {
      await db.query(`CREATE INDEX idx_${table}_companyID ON \`${table}\` (companyID)`);
    } catch (_) {
      // index may exist
    }
  }

  console.log('companyID scope migration done');
  await db.end();
}

run().catch((err) => {
  console.error('migrate_company_scope failed:', err.message);
  process.exit(1);
});
