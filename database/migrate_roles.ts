/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_roles
 * Edit Date: 2026-11-12
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { DEFAULT_ROLES  } from '../config/roles';

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
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      level INT NOT NULL UNIQUE,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(255) NOT NULL,
      color VARCHAR(20) DEFAULT '#64748b',
      is_default TINYINT(1) NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  for (const role of DEFAULT_ROLES) {
    await db.query(
      `INSERT INTO roles (level, code, name, description, color, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description),
         color = VALUES(color),
         is_default = 1,
         is_active = 1`,
      [role.level, role.code, role.name, role.description, role.color]
    );
  }

  console.log('Roles table ready with 7 default levels.');
  await db.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
