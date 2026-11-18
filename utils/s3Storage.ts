/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Upload files to AWS S3 (fallback to local disk when unset)
 * Edit Date: 2026-11-18
 */

import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

type StoredFile = {
  url: string;
  filename: string;
  key?: string;
  storage: 's3' | 'local';
};

function env(name: string) {
  return String(process.env[name] || '').trim();
}

export function isS3Configured() {
  return Boolean(
    env('AWS_ACCESS_KEY_ID') &&
      env('AWS_SECRET_ACCESS_KEY') &&
      env('AWS_S3_BUCKET') &&
      env('AWS_REGION')
  );
}

let client: S3Client | null = null;

function getClient() {
  if (!client) {
    client = new S3Client({
      region: env('AWS_REGION'),
      credentials: {
        accessKeyId: env('AWS_ACCESS_KEY_ID'),
        secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }
  return client;
}

function publicUrlForKey(key: string) {
  const custom = env('AWS_S3_PUBLIC_URL') || env('AWS_CDN_URL');
  if (custom) {
    return `${custom.replace(/\/$/, '')}/${key}`;
  }
  const bucket = env('AWS_S3_BUCKET');
  const region = env('AWS_REGION');
  // Virtual-hosted–style URL
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function safeExt(originalName: string, fallback = '.bin') {
  const ext = path.extname(originalName || '').toLowerCase();
  return ext || fallback;
}

export function makeFilename(prefix: string, originalName: string, fallbackExt = '.bin') {
  const ext = safeExt(originalName, fallbackExt);
  return `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
}

/** Persist multer memory file to S3 (preferred) or local uploads/<folder>. */
export async function storeUpload(
  file: Express.Multer.File,
  folder: 'products' | 'staff' | 'company' | 'support',
  filename?: string
): Promise<StoredFile> {
  if (!file?.buffer?.length) {
    throw new Error('Empty upload buffer');
  }

  const name = filename || makeFilename(folder.replace(/s$/, ''), file.originalname);
  const key = `${folder}/${name}`;

  if (isS3Configured()) {
    const base = {
      Bucket: env('AWS_S3_BUCKET'),
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream',
    };
    try {
      // Prefer ACL when bucket allows it; many new buckets disable ACLs.
      await getClient().send(new PutObjectCommand({ ...base, ACL: 'public-read' }));
    } catch (err: any) {
      const msg = String(err?.name || err?.Code || err?.message || '');
      if (/AccessControlListNotSupported|InvalidRequest|AccessDenied/i.test(msg)) {
        await getClient().send(new PutObjectCommand(base));
      } else {
        throw err;
      }
    }
    return {
      url: publicUrlForKey(key),
      filename: name,
      key,
      storage: 's3',
    };
  }

  const dir = path.join(__dirname, '..', 'uploads', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return {
    url: `/api/uploads/${folder}/${name}`,
    filename: name,
    storage: 'local',
  };
}
