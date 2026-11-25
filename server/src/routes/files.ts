/** Files attached to a filing or a meeting. Visible to whoever can see that client; added by staff and client approvers. */
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema, h, audit, HttpError, notFound } from '../lib/core.js';
import { requirePerm, assertClientVisible } from '../auth/session.js';
import { storage } from '../lib/storage.js';

export const filesRouter = Router();
const { attachments: a, obligations, meetings } = schema;
const MAX = 15 * 1024 * 1024;
const TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'text/plain': 'txt',
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX, files: 1 } });
const tid = (req: any) => req.staff.tenant.id as string;

/** The client a filing / meeting belongs to (and that it is in this workspace). */
async function ownerClient(tenantId: string, entity: string, entityId: string) {
  const table = entity === 'obligation' ? obligations : entity === 'meeting' ? meetings : null;
  if (!table) throw new HttpError(400, 'Unknown item');
  const [row] = await db.select({ clientId: table.clientId }).from(table).where(and(eq(table.id, entityId), eq(table.tenantId, tenantId)));
  if (!row) throw notFound('Item not found');
  return row.clientId;
}

filesRouter.get('/', requirePerm('clients.view'), h(async (req, res) => {
  const { entity, entityId } = req.query as Record<string, string>;
  assertClientVisible(req, await ownerClient(tid(req), entity, entityId));
  res.json(await db.select({ id: a.id, fileName: a.fileName, contentType: a.contentType, size: a.size, uploadedByName: a.uploadedByName, createdAt: a.createdAt })
    .from(a).where(and(eq(a.tenantId, tid(req)), eq(a.entity, entity), eq(a.entityId, entityId))).orderBy(desc(a.createdAt)));
}));

filesRouter.post('/', upload.single('file'), h(async (req, res) => {
  const p = req.staff!.permissions;
  if (!p.has('compliance.work') && !p.has('compliance.client_approve')) throw new HttpError(403, 'You can’t add files');
  if (!req.file) throw new HttpError(400, 'Choose a file');
  const ext = TYPES[req.file.mimetype];
  if (!ext) throw new HttpError(400, 'Use a PDF, image, Word, Excel, text or zip file');
  const { entity, entityId } = req.body as Record<string, string>;
  const clientId = await ownerClient(tid(req), entity, entityId);
  assertClientVisible(req, clientId);
  const key = `${tid(req)}/${clientId}/${randomUUID()}.${ext}`;
  await (await storage()).put(key, req.file.buffer, req.file.mimetype);
  const name = req.file.originalname.replace(/[^\w.\- ()&]+/g, '_').slice(0, 150) || `file.${ext}`;
  const [row] = await db.insert(a).values({ tenantId: tid(req), clientId, entity, entityId, fileName: name, contentType: req.file.mimetype, size: req.file.size, storageKey: key, uploadedById: req.staff!.user.id, uploadedByName: req.staff!.user.name }).returning();
  await audit(req, 'file.add', entity, entityId, { file: name });
  res.status(201).json({ id: row.id, fileName: row.fileName, size: row.size });
}));

filesRouter.get('/:id', requirePerm('clients.view'), h(async (req, res) => {
  const [row] = await db.select().from(a).where(and(eq(a.id, req.params.id), eq(a.tenantId, tid(req))));
  if (!row) throw notFound('File not found');
  assertClientVisible(req, row.clientId);
  const got = await (await storage()).get(row.storageKey, { fileName: row.fileName, contentType: row.contentType });
  if ('url' in got) return res.redirect(got.url);
  res.setHeader('Content-Type', row.contentType);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(row.fileName)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  got.stream.pipe(res);
}));

filesRouter.delete('/:id', requirePerm('compliance.work'), h(async (req, res) => {
  const [row] = await db.select().from(a).where(and(eq(a.id, req.params.id), eq(a.tenantId, tid(req))));
  if (!row) throw notFound('File not found');
  assertClientVisible(req, row.clientId);
  await db.delete(a).where(eq(a.id, row.id));
  await (await storage()).remove(row.storageKey).catch(() => {});
  await audit(req, 'file.delete', row.entity, row.entityId, { file: row.fileName });
  res.json({ ok: true });
}));
