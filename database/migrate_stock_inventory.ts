/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_stock_inventory
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

  await addColumn(db, 'products', 'purchase_price', 'purchase_price DECIMAL(10,2) DEFAULT NULL AFTER price');
  await addColumn(db, 'products', 'hsn_code', 'hsn_code VARCHAR(20) DEFAULT NULL AFTER barcode');
  await addColumn(db, 'products', 'gst_rate', 'gst_rate DECIMAL(5,2) DEFAULT 0 AFTER hsn_code');
  await addColumn(db, 'products', 'min_stock', 'min_stock INT NOT NULL DEFAULT 10 AFTER stock');
  await addColumn(db, 'products', 'reorder_qty', 'reorder_qty INT NOT NULL DEFAULT 0 AFTER min_stock');
  await addColumn(db, 'products', 'warehouse', 'warehouse VARCHAR(120) DEFAULT NULL AFTER reorder_qty');
  await addColumn(
    db,
    'products',
    'stock_status',
    `stock_status ENUM('in_stock','low_stock','out_of_stock') NOT NULL DEFAULT 'in_stock' AFTER warehouse`
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      variant_id INT DEFAULT NULL,
      movement_type ENUM(
        'in','out','adjust','transfer','sale','return','purchase','cancel','pos'
      ) NOT NULL,
      qty INT NOT NULL,
      qty_before INT NOT NULL DEFAULT 0,
      qty_after INT NOT NULL DEFAULT 0,
      from_location VARCHAR(120) DEFAULT NULL,
      to_location VARCHAR(120) DEFAULT NULL,
      ref_type VARCHAR(40) DEFAULT NULL,
      ref_id INT DEFAULT NULL,
      note TEXT,
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_stock_mov_product (product_id),
      INDEX idx_stock_mov_variant (variant_id),
      INDEX idx_stock_mov_type (movement_type),
      CONSTRAINT fk_stock_mov_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_stock_mov_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    UPDATE products
    SET stock_status = CASE
      WHEN stock <= 0 THEN 'out_of_stock'
      WHEN stock <= COALESCE(NULLIF(min_stock, 0), 10) THEN 'low_stock'
      ELSE 'in_stock'
    END
  `);

  console.log('Stock inventory migration ready.');
  await db.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
