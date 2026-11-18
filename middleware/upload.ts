/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Multer product image upload (memory → S3/local)
 * Edit Date: 2026-11-18
 */

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

export { upload };
