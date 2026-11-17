/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Multer staff profile photo upload
 * Edit Date: 2026-11-14
 */

import path from 'path';
import fs from 'fs';
import multer from 'multer';

const uploadDir = path.join(__dirname, '..', 'uploads', 'staff');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `staff_${Date.now()}_${Math.round(Math.random() * 1e6)}${safeExt}`);
  },
});

const staffUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

export { staffUpload, uploadDir as staffUploadDir };
