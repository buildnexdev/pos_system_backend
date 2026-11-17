/**
 * Reset Super Admin password to bcrypt hash and ensure flags/companyID.
 * Run: npx tsx database/fix_superadmin_password.ts
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const email = process.env.SUPERADMIN_EMAIL || 'superadmin@buildnexshopos.com';
  const password = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@123';

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
  });

  const [rows]: any = await db.query(
    `SELECT userID, name, email, password, companyID, roleID, isAdmin, isSuperAdmin, branchID, is_active
     FROM tblUser WHERE email = ? LIMIT 1`,
    [email]
  );

  if (!rows.length) {
    console.error('Super Admin not found:', email);
    process.exit(1);
  }

  const u = rows[0];
  console.log('Before:', {
    userID: u.userID,
    email: u.email,
    companyID: u.companyID,
    isAdmin: u.isAdmin,
    isSuperAdmin: u.isSuperAdmin,
    branchID: u.branchID,
    is_active: u.is_active,
    passwordPrefix: String(u.password || '').slice(0, 10),
  });

  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `UPDATE tblUser
     SET password = ?, isAdmin = 1, isSuperAdmin = 1, branchID = 0, companyID = 0, is_active = 1
     WHERE userID = ?`,
    [hash, u.userID]
  );

  const [after]: any = await db.query(
    `SELECT userID, email, companyID, isAdmin, isSuperAdmin, branchID, is_active, password
     FROM tblUser WHERE userID = ?`,
    [u.userID]
  );
  const a = after[0];
  const ok = await bcrypt.compare(password, a.password);
  console.log('After:', {
    userID: a.userID,
    email: a.email,
    companyID: a.companyID,
    isAdmin: a.isAdmin,
    isSuperAdmin: a.isSuperAdmin,
    branchID: a.branchID,
    is_active: a.is_active,
    passwordIsBcrypt: String(a.password).startsWith('$2'),
    loginWorks: ok,
    loginPassword: password,
  });

  await db.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
