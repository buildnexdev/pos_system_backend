/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_orders_workflow
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

async function tableExists(db, table) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows[0].cnt) > 0;
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
    ALTER TABLE orders
    MODIFY status ENUM(
      'pending','confirmed','processing','packed','shipped','delivered',
      'cancelled','return_requested','returned','refund_pending','refunded'
    ) NOT NULL DEFAULT 'pending'
  `);
  console.log('updated orders.status enum');

  await db.query(`
    ALTER TABLE orders
    MODIFY payment_status ENUM(
      'pending','paid','failed','refund_pending','refunded'
    ) NOT NULL DEFAULT 'pending'
  `);
  console.log('updated orders.payment_status enum');

  await addColumn(db, 'orders', 'order_source', `order_source ENUM('online','pos','admin') NOT NULL DEFAULT 'admin' AFTER order_number`);
  await addColumn(
    db,
    'orders',
    'fulfillment_status',
    `fulfillment_status ENUM('unfulfilled','processing','packed','shipped','delivered','returned','cancelled') NOT NULL DEFAULT 'unfulfilled' AFTER status`
  );
  await addColumn(db, 'orders', 'discount', 'discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal');
  await addColumn(db, 'orders', 'coupon_discount', 'coupon_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER discount');
  await addColumn(db, 'orders', 'tax_amount', 'tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER coupon_discount');
  await addColumn(db, 'orders', 'courier', 'courier VARCHAR(120) DEFAULT NULL AFTER notes');
  await addColumn(db, 'orders', 'tracking_number', 'tracking_number VARCHAR(120) DEFAULT NULL AFTER courier');
  await addColumn(db, 'orders', 'tracking_url', 'tracking_url VARCHAR(255) DEFAULT NULL AFTER tracking_number');
  await addColumn(db, 'orders', 'expected_delivery_date', 'expected_delivery_date DATE DEFAULT NULL AFTER tracking_url');
  await addColumn(db, 'orders', 'shipped_at', 'shipped_at DATETIME DEFAULT NULL AFTER expected_delivery_date');
  await addColumn(db, 'orders', 'delivered_at', 'delivered_at DATETIME DEFAULT NULL AFTER shipped_at');
  await addColumn(db, 'orders', 'cancellation_reason', 'cancellation_reason TEXT DEFAULT NULL AFTER delivered_at');
  await addColumn(db, 'orders', 'return_reason', 'return_reason TEXT DEFAULT NULL AFTER cancellation_reason');
  await addColumn(db, 'orders', 'refund_amount', 'refund_amount DECIMAL(10,2) DEFAULT NULL AFTER return_reason');
  await addColumn(db, 'orders', 'refund_method', 'refund_method VARCHAR(80) DEFAULT NULL AFTER refund_amount');
  await addColumn(
    db,
    'orders',
    'refund_status',
    `refund_status ENUM('none','pending','completed','failed') NOT NULL DEFAULT 'none' AFTER refund_method`
  );
  await addColumn(db, 'orders', 'is_archived', 'is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
  await addColumn(db, 'orders', 'stock_reserved', 'stock_reserved TINYINT(1) NOT NULL DEFAULT 0 AFTER is_archived');
  await addColumn(db, 'orders', 'stock_deducted', 'stock_deducted TINYINT(1) NOT NULL DEFAULT 0 AFTER stock_reserved');
  await addColumn(db, 'orders', 'refund_completed', 'refund_completed TINYINT(1) NOT NULL DEFAULT 0 AFTER stock_deducted');
  await addColumn(db, 'orders', 'return_restocked', 'return_restocked TINYINT(1) NOT NULL DEFAULT 0 AFTER refund_completed');

  if (!(await tableExists(db, 'order_status_history'))) {
    await db.query(`
      CREATE TABLE order_status_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        from_status VARCHAR(40) DEFAULT NULL,
        to_status VARCHAR(40) NOT NULL,
        payment_status VARCHAR(40) DEFAULT NULL,
        fulfillment_status VARCHAR(40) DEFAULT NULL,
        note TEXT DEFAULT NULL,
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_osh_order (order_id),
        CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('created order_status_history');
  } else {
    console.log('skip order_status_history');
  }

  try {
    await db.query(`
      ALTER TABLE stock_movements
      MODIFY movement_type ENUM(
        'in','out','adjust','transfer','sale','return','purchase','cancel','pos',
        'opening','damaged','reserve','release'
      ) NOT NULL
    `);
    console.log('updated stock_movements.movement_type enum');
  } catch (e) {
    console.log('stock_movements enum note:', e.message);
  }

  console.log('Orders workflow migration ready.');
  await db.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
