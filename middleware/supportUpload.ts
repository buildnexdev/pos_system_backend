/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Multer support attachment upload (memory → S3/local)
 * Edit Date: 2026-11-18
 */

import multer from 'multer';

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const supportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Only images (JPG/PNG/WEBP/GIF) and PDF are allowed'));
    }
    cb(null, true);
  },
});

export { supportUpload };
