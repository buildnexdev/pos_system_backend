/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_stock_code
 * Edit Date: 2026-11-12
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const c: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
  });

  for (const [name, def] of [
    ['stock_code', "VARCHAR(60) DEFAULT NULL AFTER sku"],
    ['barcode', "VARCHAR(80) DEFAULT NULL AFTER stock_code"],
  ]) {
    const [rows] = await c.query('SHOW COLUMNS FROM products LIKE ?', [name]);
    if (!rows.length) {
      await c.query(`ALTER TABLE products ADD COLUMN ${name} ${def}`);
      console.log('added', name);
    } else {
      console.log('exists', name);
    }
  }

  await c.query(`
    UPDATE products
    SET stock_code = COALESCE(NULLIF(stock_code, ''), sku),
        barcode = COALESCE(NULLIF(barcode, ''), COALESCE(NULLIF(stock_code, ''), sku))
    WHERE stock_code IS NULL OR stock_code = '' OR barcode IS NULL OR barcode = ''
  `);

  try {
    await c.query('CREATE UNIQUE INDEX uniq_products_stock_code ON products (stock_code)');
    console.log('unique index stock_code');
  } catch (e) {
    console.log('index note:', e.message);
  }

  await c.end();
  console.log('done');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
