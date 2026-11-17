/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_branches_warehouses
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
    CREATE TABLE IF NOT EXISTS branches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      code VARCHAR(40) NOT NULL UNIQUE,
      phone VARCHAR(40) DEFAULT NULL,
      email VARCHAR(150) DEFAULT NULL,
      address TEXT DEFAULT NULL,
      city VARCHAR(80) DEFAULT NULL,
      state VARCHAR(80) DEFAULT NULL,
      pincode VARCHAR(20) DEFAULT NULL,
      country VARCHAR(80) DEFAULT 'India',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  console.log('branches table ready');

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

  await addColumn(db, 'warehouses', 'branch_id', 'branch_id INT DEFAULT NULL AFTER code');
  await addColumn(db, 'warehouses', 'phone', 'phone VARCHAR(40) DEFAULT NULL AFTER is_active');
  await addColumn(db, 'warehouses', 'email', 'email VARCHAR(150) DEFAULT NULL AFTER phone');
  await addColumn(db, 'warehouses', 'address', 'address TEXT DEFAULT NULL AFTER email');
  await addColumn(db, 'warehouses', 'city', 'city VARCHAR(80) DEFAULT NULL AFTER address');
  await addColumn(db, 'warehouses', 'state', 'state VARCHAR(80) DEFAULT NULL AFTER city');
  await addColumn(db, 'warehouses', 'pincode', 'pincode VARCHAR(20) DEFAULT NULL AFTER state');
  await addColumn(db, 'warehouses', 'country', "country VARCHAR(80) DEFAULT 'India' AFTER pincode");
  await addColumn(db, 'warehouses', 'contact_person', 'contact_person VARCHAR(120) DEFAULT NULL AFTER country');

  // FK if missing
  try {
    const [fks] = await db.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouses'
         AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_wh_branch'`
    );
    if (!fks.length) {
      await db.query(
        `ALTER TABLE warehouses
         ADD CONSTRAINT fk_wh_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL`
      );
      console.log('added fk_wh_branch');
    }
  } catch (e) {
    console.log('fk_wh_branch note:', e.message);
  }

  const [main] = await db.query(`SELECT id FROM warehouses WHERE code = 'MAIN' LIMIT 1`);
  if (!main.length) {
    await db.query(
      `INSERT INTO warehouses (name, code, is_default, is_active) VALUES ('Main Warehouse', 'MAIN', 1, 1)`
    );
    console.log('seeded MAIN warehouse');
  }

  console.log('Branch / warehouse address migration ready.');
  await db.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
