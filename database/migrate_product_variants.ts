/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_product_variants
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

  await c.query(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      size VARCHAR(40) NOT NULL,
      color VARCHAR(50) NOT NULL,
      stock INT NOT NULL DEFAULT 0,
      stock_code VARCHAR(60) DEFAULT NULL,
      barcode VARCHAR(80) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_product_size_color (product_id, size, color),
      CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  console.log('product_variants ready');

  const [countRows] = await c.query('SELECT COUNT(*) AS c FROM product_variants');
  if (!countRows[0].c) {
    const [products] = await c.query('SELECT id, sku, stock_code, barcode, stock, sizes, colors FROM products');
    for (const p of products) {
      const sizes = String(p.sizes || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const colors = String(p.colors || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!sizes.length || !colors.length) continue;

      let first = true;
      let n = 1;
      for (const color of colors) {
        for (const size of sizes) {
          const code = `${p.stock_code || p.sku || `STK-${p.id}`}-${String(n).padStart(2, '0')}`;
          await c.query(
            `INSERT INTO product_variants (product_id, size, color, stock, stock_code, barcode)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [p.id, size, color, first ? Number(p.stock) || 0 : 0, code, code]
          );
          first = false;
          n += 1;
        }
      }
    }
    console.log('seeded variants from existing products');
  }

  await c.end();
  console.log('done');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
