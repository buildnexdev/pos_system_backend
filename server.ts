/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Express API entrypoint for BuildNex ShopOS
 * Edit Date: 2026-11-12
 */

import path from 'path';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { apiErrorHtml, apiNotFoundHtml, wantsHtml } from './utils/apiScreens';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173,https://pos.buildnexdev.in')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/$/, '');
      if (clientUrls.includes(cleanOrigin) || clientUrls.includes('*')) {
        return callback(null, true);
      }
      // If client origin is from buildnexdev.in or localhost, allow it
      if (/^https?:\/\/([a-z0-9-]+\.)?buildnexdev\.in$/i.test(cleanOrigin) || cleanOrigin.includes('localhost')) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  if (wantsHtml(req.headers.accept)) {
    return res.redirect(302, '/api');
  }
  return res.json({ success: true, message: 'BuildNex ShopOS API', base: '/api' });
});

app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api', routes);

app.use((req: Request, res: Response) => {
  if (wantsHtml(req.headers.accept)) {
    return res.status(404).type('html').send(apiNotFoundHtml(req.originalUrl || req.url));
  }
  return res.status(404).json({ success: false, message: 'API route not found' });
});

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  console.error(err);
  if (wantsHtml(req.headers.accept)) {
    return res.status(500).type('html').send(apiErrorHtml('Server error'));
  }
  return res.status(500).json({ success: false, message: 'Server error' });
};
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`BuildNex ShopOS API running at http://localhost:${PORT}/api`);
});
