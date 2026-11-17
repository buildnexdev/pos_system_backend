/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_inventory
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      code VARCHAR(40) NOT NULL UNIQUE,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const [wh] = await db.query(`SELECT id FROM warehouses WHERE code = 'MAIN' LIMIT 1`);
  let warehouseId;
  if (!wh.length) {
    const [ins] = await db.query(
      `INSERT INTO warehouses (name, code, is_default, is_active) VALUES ('Main Warehouse', 'MAIN', 1, 1)`
    );
    warehouseId = ins.insertId;
    console.log('seeded warehouse MAIN');
  } else {
    warehouseId = wh[0].id;
    console.log('warehouse MAIN exists');
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      variant_id INT NOT NULL,
      warehouse_id INT NOT NULL,
      opening_stock INT NOT NULL DEFAULT 0,
      purchased_qty INT NOT NULL DEFAULT 0,
      sold_qty INT NOT NULL DEFAULT 0,
      damaged_qty INT NOT NULL DEFAULT 0,
      returned_qty INT NOT NULL DEFAULT 0,
      reserved_qty INT NOT NULL DEFAULT 0,
      available_qty INT NOT NULL DEFAULT 0,
      min_stock INT NOT NULL DEFAULT 10,
      status ENUM('in_stock','low_stock','out_of_stock','reserved','damaged') NOT NULL DEFAULT 'out_of_stock',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_variant_warehouse (variant_id, warehouse_id),
      INDEX idx_inv_product (product_id),
      INDEX idx_inv_warehouse (warehouse_id),
      CONSTRAINT fk_inv_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_inv_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
      CONSTRAINT fk_inv_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB;
  `);

  await addColumn(db, 'stock_movements', 'warehouse_id', 'warehouse_id INT DEFAULT NULL AFTER variant_id');
  await addColumn(db, 'stock_movements', 'supplier_id', 'supplier_id INT DEFAULT NULL AFTER warehouse_id');
  await addColumn(db, 'stock_movements', 'reference_no', 'reference_no VARCHAR(80) DEFAULT NULL AFTER supplier_id');
  await addColumn(db, 'stock_movements', 'movement_date', 'movement_date DATETIME DEFAULT NULL AFTER reference_no');

  // Expand movement_type enum if needed (MySQL modify)
  try {
    await db.query(`
      ALTER TABLE stock_movements
      MODIFY movement_type ENUM(
        'in','out','adjust','transfer','sale','return','purchase','cancel','pos',
        'opening','damaged'
      ) NOT NULL
    `);
    console.log('updated stock_movements.movement_type enum');
  } catch (e) {
    console.log('movement_type enum note:', e.message);
  }

  const [variants] = await db.query(
    `SELECT id, product_id, stock FROM product_variants`
  );
  let created = 0;
  for (const v of variants) {
    const qty = Number(v.stock) || 0;
    const min = 10;
    const status = qty <= 0 ? 'out_of_stock' : qty <= min ? 'low_stock' : 'in_stock';
    const [existing] = await db.query(
      `SELECT id FROM inventory WHERE variant_id = ? AND warehouse_id = ? LIMIT 1`,
      [v.id, warehouseId]
    );
    if (existing.length) continue;
    await db.query(
      `INSERT INTO inventory
        (product_id, variant_id, warehouse_id, opening_stock, available_qty, min_stock, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [v.product_id, v.id, warehouseId, qty, qty, min, status]
    );
    created += 1;
  }
  console.log(`inventory backfill rows: ${created}`);

  console.log('Inventory migration ready.');
  await db.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
