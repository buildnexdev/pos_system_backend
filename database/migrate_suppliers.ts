/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_suppliers
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
    CREATE TABLE IF NOT EXISTS suppliers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      email VARCHAR(150) DEFAULT NULL,
      address VARCHAR(255) DEFAULT NULL,
      contact_person VARCHAR(120) DEFAULT NULL,
      notes TEXT,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  console.log('suppliers table ready');

  const [cols] = await c.query("SHOW COLUMNS FROM products LIKE 'supplier_id'");
  if (!cols.length) {
    await c.query('ALTER TABLE products ADD COLUMN supplier_id INT DEFAULT NULL AFTER fabric');
    try {
      await c.query(
        'ALTER TABLE products ADD CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL'
      );
    } catch (e) {
      console.log('fk note:', e.message);
    }
    console.log('added products.supplier_id');
  } else {
    console.log('products.supplier_id exists');
  }

  const [countRows] = await c.query('SELECT COUNT(*) AS c FROM suppliers');
  if (!countRows[0].c) {
    await c.query(
      `INSERT INTO suppliers (name, phone, email, address, contact_person, is_active) VALUES
       ('StyleWear Suppliers', '9876500001', 'supply@stylewear.com', '12 Textile Hub, Tirupur', 'Ravi Kumar', 1),
       ('DenimCo India', '9876500002', 'orders@denimco.in', '88 Denim Park, Bangalore', 'Anita Shah', 1),
       ('EthnicEdge Traders', '9876500003', 'hello@ethnicedge.in', '5 Silk Street, Surat', 'Meera Patel', 1)`
    );
    console.log('seeded suppliers');
  }

  await c.end();
  console.log('done');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
