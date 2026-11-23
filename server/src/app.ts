import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { HttpError, env } from './lib/core.js';
import { requireStaff } from './auth/session.js';
import { authRouter } from './routes/auth.js';
import { clientsRouter } from './routes/clients.js';
import { obligationsRouter } from './routes/obligations.js';
import { adminRouter } from './routes/admin.js';
import { importRouter } from './routes/import.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // CSRF: every state-changing API call must come from our own page (fetch sets this header; forms can't).
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'fetch') return next(new HttpError(403, 'Bad request origin'));
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/clients', requireStaff, clientsRouter);
  app.use('/api/obligations', requireStaff, obligationsRouter);
  app.use('/api/import', requireStaff, importRouter);
  app.use('/api/admin', requireStaff, adminRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'No such API')));

  // The built web app (production: one container serves both).
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.code === '23505') return res.status(409).json({ error: 'This already exists' });
    console.error(err);
    res.status(500).json({ error: env.isProd ? 'Something went wrong' : String(err?.message ?? err) });
  });
  return app;
}
