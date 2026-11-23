/** Environment, database, HTTP errors, crypto and audit: the small pieces every route uses. */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NextFunction, Request, Response, RequestHandler } from 'express';
import * as schema from '../db/schema.js';

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/secretarial',
  isProd: process.env.NODE_ENV === 'production',
  migrateOnStart: process.env.MIGRATE_ON_START === 'true',
};

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
export const db = drizzle(pool, { schema });
export { schema };

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export const notFound = (what = 'Not found') => new HttpError(404, what);

/** Wraps an async route so thrown errors reach the error handler. */
export const h = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function audit(req: Request, action: string, entity: string, entityId: string | null, data?: unknown) {
  if (!req.staff) return;
  await db.insert(schema.auditLog).values({ tenantId: req.staff.tenant.id, userId: req.staff.user.id, action, entity, entityId, data: data ?? null });
}
