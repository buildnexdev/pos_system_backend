/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_pos_billing
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

async function tableExists(db, table) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
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
    ALTER TABLE orders
    MODIFY payment_method ENUM(
      'cod', 'online', 'cash', 'upi', 'card', 'credit', 'split'
    ) NOT NULL DEFAULT 'cod'
  `);
  console.log('updated orders.payment_method enum');

  await addColumn(db, 'orders', 'round_off', 'round_off DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER shipping_fee');
  await addColumn(db, 'orders', 'amount_received', 'amount_received DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER total');
  await addColumn(db, 'orders', 'change_amount', 'change_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER amount_received');
  await addColumn(
    db,
    'orders',
    'client_request_id',
    'client_request_id VARCHAR(64) DEFAULT NULL AFTER notes'
  );

  try {
    await db.query('CREATE UNIQUE INDEX uniq_orders_client_request ON orders (client_request_id)');
    console.log('added uniq_orders_client_request');
  } catch (e) {
    if (e && e.code !== 'ER_DUP_KEYNAME') throw e;
    console.log('skip uniq_orders_client_request');
  }

  if (!(await tableExists(db, 'pos_payments'))) {
    await db.query(`
      CREATE TABLE pos_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        method ENUM('cash', 'upi', 'card', 'credit', 'online', 'cod') NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        reference_no VARCHAR(120) DEFAULT NULL,
        status ENUM('pending', 'paid', 'failed') NOT NULL DEFAULT 'paid',
        paid_at DATETIME DEFAULT NULL,
        received_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pos_pay_order (order_id),
        CONSTRAINT fk_pos_pay_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_pos_pay_user FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
    console.log('created pos_payments');
  } else {
    console.log('skip pos_payments');
  }

  await db.end();
  console.log('POS billing migration done');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
