/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Multer product image upload middleware
 * Edit Date: 2026-11-12
 */

import path from 'path';
import fs from 'fs';
import multer from 'multer';

const uploadDir = path.join(__dirname, '..', 'uploads', 'tblProduct');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `product_${Date.now()}_${Math.round(Math.random() * 1e6)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

export { upload, uploadDir };
