/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: MySQL connection pool configuration
 * Edit Date: 2026-11-12
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || process.env.DB_DATABASE || 'garments_shop',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

/** Typed loosely for gradual TS migration of query destructuring patterns */
const db = pool as any;

export default db;
