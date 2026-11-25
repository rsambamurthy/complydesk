/** Regulatory updates for a firm (published ones, with affected clients) and for Integrata (draft, edit, publish). */
import { Router } from 'express';
import multer from 'multer';
import { h, audit } from '../lib/core.js';
import { clientScope, requirePerm, requirePlatformAdmin } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { draftFromDocument, firmUpdates, listAll, markReviewed, publishUpdate, removeUpdate, saveUpdate, unmarkReviewed, unreviewedCount, updateInput } from '../services/regulatory.js';

export const regulatoryRouter = Router();
regulatoryRouter.get('/', requirePerm('clients.view'), h(async (req, res) => res.json(await firmUpdates(req.staff!.tenant, clientScope(req)))));
regulatoryRouter.get('/count', requirePerm('clients.view'), h(async (req, res) => res.json({ unreviewed: req.staff!.user.clientIds.length ? 0 : await unreviewedCount(req.staff!.tenant) })));
regulatoryRouter.post('/:id/review', requirePerm('compliance.work'), h(async (req, res) => {
  await markReviewed(req.staff!.tenant.id, req.staff!.user.id, req.params.id, typeof req.body?.note === 'string' ? req.body.note.slice(0, 1000) : null);
  await audit(req, 'regulatory.review', 'reg_update', req.params.id, req.body);
  res.json({ ok: true });
}));
regulatoryRouter.delete('/:id/review', requirePerm('compliance.work'), h(async (req, res) => { await unmarkReviewed(req.staff!.tenant.id, req.params.id); res.json({ ok: true }); }));

export const platformRegRouter = Router();
platformRegRouter.use(requirePlatformAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
platformRegRouter.get('/', h(async (_req, res) => res.json(await listAll())));
platformRegRouter.post('/draft', upload.single('file'), h(async (req, res) => res.json(await draftFromDocument({ text: req.body?.text, file: req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype } : undefined }))));
platformRegRouter.post('/', h(async (req, res) => res.status(201).json(await saveUpdate(null, parse(updateInput, req.body), req.staff!.user.email))));
platformRegRouter.put('/:id', h(async (req, res) => res.json(await saveUpdate(req.params.id, parse(updateInput, req.body), req.staff!.user.email))));
platformRegRouter.delete('/:id', h(async (req, res) => { await removeUpdate(req.params.id); res.json({ ok: true }); }));
platformRegRouter.post('/:id/publish', h(async (req, res) => res.json(await publishUpdate(req.params.id))));
