/** Reading documents into forms. Routes check permissions; services/extract.ts does the work. */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { h, audit, HttpError } from '../lib/core.js';
import { requirePerm, assertClientVisible } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { DOC_TYPES, isDocType } from '../extract/doctypes.js';
import { BALANCE_SHEET, PROFIT_LOSS, checkStatements } from '../financials/statements.js';
import { applyDsc, applyRead, attachRead, dailyLimit, docTypeList, extractEnabled, openRead, paidUpFor, readDscFiles, readUpload } from '../services/extract.js';

export const extractRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 20 } });

extractRouter.get('/types', h(async (_req, res) => res.json({ enabled: extractEnabled(), dailyLimit: dailyLimit(), types: docTypeList() })));

extractRouter.post('/', upload.single('file'), h(async (req, res) => {
  const { docType, clientId, obligationId } = req.body as Record<string, string>;
  if (!isDocType(docType)) throw new HttpError(400, 'Pick what kind of document this is');
  if (!req.staff!.permissions.has(DOC_TYPES[docType].perm)) throw new HttpError(403, 'You don’t have permission to do this');
  if (!req.file) throw new HttpError(400, 'Choose a file');
  if (clientId) assertClientVisible(req, clientId);
  const out = await readUpload(req.staff!, { docType, file: req.file, clientId: clientId || null, obligationId: obligationId || null });
  await audit(req, 'document.read', 'extraction', out.id, { docType, file: out.fileName });
  res.status(201).json(out);
}));

// DSC routes first, so /dsc/apply isn't taken for /:id/apply.
extractRouter.post('/dsc', requirePerm('clients.manage'), upload.array('files', 20), h(async (req, res) => {
  const clientId = String(req.body.clientId ?? '');
  assertClientVisible(req, clientId);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw new HttpError(400, 'Choose the certificate files');
  res.json(await readDscFiles(req.staff!.tenant.id, clientId, files));
}));

extractRouter.post('/dsc/apply', requirePerm('clients.manage'), h(async (req, res) => {
  const body = parse(z.object({ clientId: z.string(), updates: z.array(z.object({ personId: z.string(), dscExpiry: z.string() })).min(1, 'Nothing to update') }), req.body);
  assertClientVisible(req, body.clientId);
  const out = await applyDsc(req.staff!.tenant.id, body.clientId, body.updates);
  await audit(req, 'people.dsc', 'client', body.clientId, { updated: out.updated });
  res.json(out);
}));

// Financial statements on an AOC-4 filing: the line layout, and the checks again after a person edits the figures.
extractRouter.get('/statement-lines', h(async (_req, res) => res.json({ groups: [...BALANCE_SHEET, ...PROFIT_LOSS] })));
extractRouter.post('/statement-check', requirePerm('compliance.work'), h(async (req, res) => {
  const body = parse(z.object({ obligationId: z.string(), roundedTo: z.number().optional(), figures: z.record(z.object({ cy: z.any(), py: z.any() })) }), req.body);
  const paidUp = await paidUpFor(req.staff!.tenant.id, body.obligationId);
  assertClientVisible(req, paidUp.clientId);
  const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(String(v).replace(/,/g, ''))) ? null : Math.round(Number(String(v).replace(/,/g, ''))));
  const figures = Object.fromEntries(Object.entries(body.figures).map(([k, x]) => [k, { cy: num(x.cy), py: num(x.py) }]));
  res.json({ issues: checkStatements(figures, { roundedTo: body.roundedTo, paidUpOnRecord: paidUp.amount }) });
}));

extractRouter.get('/:id', h(async (req, res) => {
  const out = await openRead(req.staff!, req.params.id);
  if (out.clientId) assertClientVisible(req, out.clientId);
  res.json(out);
}));

extractRouter.post('/:id/apply', requirePerm('compliance.work'), h(async (req, res) => {
  if (req.body.clientId) assertClientVisible(req, req.body.clientId);
  const out = await applyRead(req.staff!, req.params.id, req.body ?? {});
  await audit(req, 'document.apply', 'extraction', req.params.id, { clientId: out.clientId });
  res.json(out);
}));

extractRouter.post('/:id/attach', requirePerm('compliance.work'), h(async (req, res) => {
  const { obligationId } = parse(z.object({ obligationId: z.string() }), req.body);
  res.json(await attachRead(req.staff!, req.params.id, obligationId));
}));
