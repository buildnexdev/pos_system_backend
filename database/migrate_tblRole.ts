/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_tblRole
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
    CREATE TABLE IF NOT EXISTS tblRole (
      RoleId INT AUTO_INCREMENT PRIMARY KEY,
      RoleName VARCHAR(120) NOT NULL,
      RoleCode VARCHAR(50) NOT NULL UNIQUE,
      Level INT NOT NULL,
      Description VARCHAR(255) DEFAULT NULL,
      Color VARCHAR(20) DEFAULT '#64748b',
      IsDefault TINYINT(1) NOT NULL DEFAULT 0,
      IsActive TINYINT(1) NOT NULL DEFAULT 1,
      CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tblrole_level (Level)
    ) ENGINE=InnoDB;
  `);

  // Copy from old roles table if present and tblRole empty
  try {
    const [countRows] = await db.query('SELECT COUNT(*) AS c FROM tblRole');
    if (Number(countRows[0].c) === 0) {
      try {
        const [old] = await db.query(
          `SELECT level, code, name, description, color, is_default, is_active FROM roles ORDER BY level`
        );
        for (const row of old) {
          await db.query(
            `INSERT INTO tblRole (RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              row.name,
              row.code,
              row.level,
              row.description,
              row.color || '#64748b',
              row.is_default ? 1 : 0,
              row.is_active ? 1 : 0,
            ]
          );
        }
      } catch (_) {
        // old table may not exist
      }
    }
  } catch (_) {}

  for (const role of DEFAULT_ROLES) {
    await db.query(
      `INSERT INTO tblRole (RoleName, RoleCode, Level, Description, Color, IsDefault, IsActive)
       VALUES (?, ?, ?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE
         RoleName = VALUES(RoleName),
         Description = VALUES(Description),
         Color = VALUES(Color),
         Level = VALUES(Level),
         IsDefault = 1,
         IsActive = 1`,
      [role.name, role.code, role.level, role.description, role.color]
    );
  }

  console.log('tblRole ready with default levels.');
  await db.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
