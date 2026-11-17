/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_product_catalog
 * Edit Date: 2026-11-12
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function columnExists(db, table, column) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].cnt) > 0;
}

async function addColumn(db, table, column, definition) {
  if (await columnExists(db, table, column)) {
    console.log(`skip ${table}.${column}`);
    return;
  }
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  console.log(`added ${table}.${column}`);
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

  await addColumn(db, 'products', 'subcategory', 'subcategory VARCHAR(120) DEFAULT NULL AFTER category_id');
  await addColumn(db, 'products', 'material', 'material VARCHAR(120) DEFAULT NULL AFTER fabric');
  await addColumn(db, 'products', 'pattern', 'pattern VARCHAR(80) DEFAULT NULL AFTER material');
  await addColumn(db, 'products', 'fit_type', 'fit_type VARCHAR(80) DEFAULT NULL AFTER pattern');
  await addColumn(db, 'products', 'sleeve_type', 'sleeve_type VARCHAR(80) DEFAULT NULL AFTER fit_type');
  await addColumn(db, 'products', 'neck_type', 'neck_type VARCHAR(80) DEFAULT NULL AFTER sleeve_type');
  await addColumn(db, 'products', 'occasion', 'occasion VARCHAR(80) DEFAULT NULL AFTER neck_type');
  await addColumn(db, 'products', 'season', 'season VARCHAR(80) DEFAULT NULL AFTER occasion');
  await addColumn(db, 'products', 'country_of_origin', 'country_of_origin VARCHAR(80) DEFAULT NULL AFTER season');
  await addColumn(db, 'products', 'discount_type', `discount_type ENUM('percent','fixed') NOT NULL DEFAULT 'percent' AFTER discount_percent`);
  await addColumn(db, 'products', 'discount_value', 'discount_value DECIMAL(10,2) DEFAULT 0 AFTER discount_type');
  await addColumn(db, 'products', 'tax_inclusive', 'tax_inclusive TINYINT(1) NOT NULL DEFAULT 1 AFTER gst_rate');
  await addColumn(db, 'products', 'publish_online', 'publish_online TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active');
  await addColumn(db, 'products', 'is_new_arrival', 'is_new_arrival TINYINT(1) NOT NULL DEFAULT 0 AFTER publish_online');
  await addColumn(db, 'products', 'is_best_seller', 'is_best_seller TINYINT(1) NOT NULL DEFAULT 0 AFTER is_new_arrival');
  await addColumn(db, 'products', 'visibility', `visibility ENUM('public','hidden','scheduled') NOT NULL DEFAULT 'public' AFTER is_best_seller`);
  await addColumn(db, 'products', 'seo_title', 'seo_title VARCHAR(180) DEFAULT NULL AFTER visibility');
  await addColumn(db, 'products', 'seo_description', 'seo_description VARCHAR(320) DEFAULT NULL AFTER seo_title');

  await addColumn(db, 'product_variants', 'is_active', 'is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER image_url');

  console.log('Product catalog migration ready.');
  await db.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
