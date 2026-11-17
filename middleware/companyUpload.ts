/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Multer upload for company documents (PDF, images, office)
 * Edit Date: 2026-11-14
 */

import path from 'path';
import fs from 'fs';
import multer from 'multer';

const uploadDir = path.join(__dirname, '..', 'uploads', 'company');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
]);

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    const safeExt = ALLOWED_EXT.has(ext) ? ext : '.bin';
    cb(null, `company_${Date.now()}_${Math.round(Math.random() * 1e6)}${safeExt}`);
  },
});

const companyUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.has(ext)) {
      return cb(null, true);
    }
    return cb(new Error('Only PDF, image, or office documents are allowed'));
  },
});

export { companyUpload, uploadDir as companyUploadDir };
