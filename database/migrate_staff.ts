/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Database migration: migrate_staff
 * Edit Date: 2026-11-12
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const db: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
    multipleStatements: true
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS staff_education (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      degree VARCHAR(150) NOT NULL,
      institution VARCHAR(200) NOT NULL,
      year_from VARCHAR(20) DEFAULT NULL,
      year_to VARCHAR(20) DEFAULT NULL,
      grade VARCHAR(50) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_edu_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS staff_experience (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      company VARCHAR(200) NOT NULL,
      designation VARCHAR(150) NOT NULL,
      year_from VARCHAR(20) DEFAULT NULL,
      year_to VARCHAR(20) DEFAULT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_exp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS staff_documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      doc_type VARCHAR(100) NOT NULL,
      doc_name VARCHAR(200) NOT NULL,
      file_url VARCHAR(500) NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_doc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS staff_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      action VARCHAR(80) NOT NULL,
      details TEXT,
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_hist_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS staff_profile (
      user_id INT NOT NULL PRIMARY KEY,
      employee_code VARCHAR(40) DEFAULT NULL,
      initial_name VARCHAR(40) DEFAULT NULL,
      date_of_birth DATE DEFAULT NULL,
      gender VARCHAR(20) DEFAULT NULL,
      blood_group VARCHAR(10) DEFAULT NULL,
      marital_status VARCHAR(30) DEFAULT NULL,
      father_name VARCHAR(120) DEFAULT NULL,
      mother_name VARCHAR(120) DEFAULT NULL,
      aadhaar VARCHAR(20) DEFAULT NULL,
      pan VARCHAR(20) DEFAULT NULL,
      emergency_name VARCHAR(120) DEFAULT NULL,
      emergency_phone VARCHAR(30) DEFAULT NULL,
      photo_url VARCHAR(500) DEFAULT NULL,
      bank_name VARCHAR(150) DEFAULT NULL,
      account_holder VARCHAR(150) DEFAULT NULL,
      account_number VARCHAR(40) DEFAULT NULL,
      ifsc_code VARCHAR(20) DEFAULT NULL,
      bank_branch VARCHAR(150) DEFAULT NULL,
      department VARCHAR(120) DEFAULT NULL,
      designation VARCHAR(120) DEFAULT NULL,
      join_date DATE DEFAULT NULL,
      employment_type VARCHAR(40) DEFAULT NULL,
      work_location VARCHAR(150) DEFAULT NULL,
      reporting_to VARCHAR(150) DEFAULT NULL,
      landmark VARCHAR(200) DEFAULT NULL,
      country VARCHAR(80) DEFAULT 'India',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  console.log('Staff tables ready.');
  await db.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
