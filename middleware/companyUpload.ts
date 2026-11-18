/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Multer company document upload (memory → S3/local)
 * Edit Date: 2026-11-18
 */

import path from 'path';
import multer from 'multer';

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

const companyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.has(ext)) {
      return cb(null, true);
    }
    return cb(new Error('Only PDF, image, or office documents are allowed'));
  },
});

export { companyUpload };
