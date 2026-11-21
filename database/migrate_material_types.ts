/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Create tblMaterialType master (replaces hardcoded fabric options)
 * Edit Date: 2026-11-20
 *
 * Run: npx tsx database/migrate_material_types.ts
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULTS = ['Cotton', 'Linen', 'Polyester', 'Silk', 'Wool', 'Denim', 'Rayon', 'Blend'];

function slugify(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'material-type';
}

async function run() {
  const db: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS tblMaterialType (
      materialTypeID INT AUTO_INCREMENT PRIMARY KEY,
      companyID INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) DEFAULT NULL,
      description VARCHAR(500) DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_material_type_company_slug (companyID, slug),
      KEY idx_material_type_company (companyID)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('tblMaterialType ready');

  const [companies] = await db.query('SELECT companyID FROM tblCompany');
  for (const c of companies) {
    const companyID = c.companyID;
    const [[{ count }]] = await db.query(
      'SELECT COUNT(*) AS count FROM tblMaterialType WHERE companyID = ?',
      [companyID]
    );
    if (Number(count) > 0) continue;

    const [rows] = await db.query(
      `SELECT DISTINCT TRIM(fabric) AS name
       FROM tblProduct
       WHERE companyID = ? AND fabric IS NOT NULL AND TRIM(fabric) <> ''
       ORDER BY name`,
      [companyID]
    );

    const fromProducts = rows.map((r: any) => String(r.name));
    const names = Array.from(new Set([...fromProducts, ...DEFAULTS]));

    for (const name of names) {
      const slug = slugify(name);
      await db.query(
        `INSERT IGNORE INTO tblMaterialType (companyID, name, slug, description, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [companyID, name, slug, null]
      );
    }
    console.log(`seeded material types for company ${companyID}: ${names.length}`);
  }

  await db.end();
  console.log('migrate_material_types done');
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
