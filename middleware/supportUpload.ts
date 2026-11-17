/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Multer support ticket attachment upload middleware
 * Edit Date: 2026-11-12
 */

import path from 'path';
import fs from 'fs';
import multer from 'multer';

const uploadDir = path.join(__dirname, '..', 'uploads', 'support');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'].includes(ext)
      ? ext
      : file.mimetype === 'application/pdf'
        ? '.pdf'
        : '.bin';
    cb(null, `support_${Date.now()}_${Math.round(Math.random() * 1e6)}${safeExt}`);
  },
});

const supportUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Only images (JPG/PNG/WEBP/GIF) and PDF are allowed'));
    }
    cb(null, true);
  },
});

export { supportUpload, uploadDir as supportUploadDir };
