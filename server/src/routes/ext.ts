/**
 * The browser extension's API (Bearer token): who am I, filings with MCA form data, a filing's form data — all read-only —
 * and one write: filing status read from the MCA portal (approved / resubmission), confirmed by the user in the panel,
 * applied through the filing workflow like any other step.
 * Token management for the signed-in user lives at /api/auth/extension-tokens; the extension download at /api/extension.zip.
 */
import { Router, type Request } from 'express';
import { and, asc, eq, ilike, inArray, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, stat } from 'node:fs/promises';
import JSZip from 'jszip';
import { db, schema, h, audit, randomToken, sha256, HttpError } from '../lib/core.js';
import { parse } from '../lib/parse.js';
import { move } from '../services/workflow.js';
import { clientScope, assertClientVisible, requireStaff } from '../auth/session.js';
import { FORM_SPECS } from '../eforms/forms.js';
import { formPack } from '../services/eforms.js';
import { getObligation } from '../services/obligations.js';

const { obligations: o, clients: c, apiTokens: k } = schema;
export const extRouter = Router();

extRouter.get('/me', h(async (req, res) => res.json({ user: { name: req.staff!.user.name, email: req.staff!.user.email }, workspace: req.staff!.tenant.name })));

extRouter.get('/filings', h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const scope = clientScope(req);
  const rows = await db.select({ id: o.id, form: o.form, fy: o.fy, periodLabel: o.periodLabel, dueDate: o.dueDate, stage: o.stage, clientName: c.name, cin: c.cin })
    .from(o).innerJoin(c, eq(c.id, o.clientId))
    .where(and(eq(o.tenantId, req.staff!.tenant.id), inArray(o.ruleCode, Object.keys(FORM_SPECS)), notInArray(o.stage, ['FILED', 'APPROVED', 'NA']),
      q ? or(ilike(c.name, `%${q}%`), ilike(c.cin, `%${q}%`), ilike(o.form, `%${q}%`)) : undefined,
      scope ? inArray(o.clientId, scope.length ? scope : ['-']) : undefined))
    .orderBy(asc(o.dueDate)).limit(40);
  res.json(rows);
}));

extRouter.get('/filings/:id/form', h(async (req, res) => {
  const ob = await getObligation(req.staff!.tenant.id, req.params.id);
  assertClientVisible(req, ob.clientId);
  res.json(await formPack(req.staff!.tenant.id, ob.id));
}));

/** Filings uploaded on MCA and waiting for its decision (stage FILED), with their SRNs — what the panel looks for. */
extRouter.get('/filed', h(async (req, res) => {
  const scope = clientScope(req);
  res.json(await db.select({ id: o.id, form: o.form, fy: o.fy, periodLabel: o.periodLabel, srn: o.srn, filedOn: o.filedOn, stage: o.stage, clientName: c.name })
    .from(o).innerJoin(c, eq(c.id, o.clientId))
    .where(and(eq(o.tenantId, req.staff!.tenant.id), eq(o.stage, 'FILED'), isNotNull(o.srn), scope ? inArray(o.clientId, scope.length ? scope : ['-']) : undefined))
    .orderBy(asc(o.filedOn)).limit(500));
}));

const statusInput = z.object({ updates: z.array(z.object({
  obligationId: z.string(), srn: z.string().trim().toUpperCase(), status: z.enum(['APPROVED', 'RESUBMIT', 'REJECTED']),
  phrase: z.string().trim().max(80).nullish(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
})).min(1).max(100) });

/** Apply statuses the user ticked in the panel: approved → "Approved by MCA"; resubmission / rejected → "MCA asked for resubmission". */
extRouter.post('/srn-status', h(async (req, res) => {
  if (!req.staff!.permissions.has('compliance.work')) throw new HttpError(403, 'You don’t have permission to update filings');
  const body = parse(statusInput, req.body);
  const results = [];
  for (const u of body.updates) {
    try {
      const ob = await getObligation(req.staff!.tenant.id, u.obligationId);
      assertClientVisible(req, ob.clientId);
      if ((ob.srn ?? '').toUpperCase() !== u.srn) throw new HttpError(409, 'SRN doesn’t match this filing');
      const seen = `MCA portal shows “${u.phrase ?? u.status.toLowerCase()}”${u.date ? ` (${u.date})` : ''} — read by the ComplyDesk extension.`;
      const note = u.status === 'REJECTED' ? `Rejected by MCA. ${seen} File again.` : seen;
      await move(ob, req.staff!, { action: u.status === 'APPROVED' ? 'approved' : 'resubmit', note, srn: null });
      await audit(req, 'obligation.mca_status', 'obligation', ob.id, u);
      results.push({ obligationId: u.obligationId, ok: true });
    } catch (e: any) { results.push({ obligationId: u.obligationId, ok: false, error: e.message }); }
  }
  res.json({ results, updated: results.filter((r) => r.ok).length });
}));

// ---- For the signed-in user (cookie session) -----------------------------------------------------------------
export const extTokensRouter = Router();
const staffOnly = (req: Request) => { if (req.staff!.user.clientIds.length) throw new HttpError(403, 'The extension is for firm staff'); };

extTokensRouter.get('/', h(async (req, res) => {
  staffOnly(req);
  res.json(await db.select({ id: k.id, name: k.name, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt }).from(k)
    .where(and(eq(k.userId, req.staff!.user.id), isNull(k.revokedAt))).orderBy(asc(k.createdAt)));
}));
extTokensRouter.post('/', h(async (req, res) => {
  staffOnly(req);
  const name = String(req.body?.name ?? '').trim().slice(0, 60) || 'Chrome';
  const token = `cdx_${randomToken()}`;
  const [row] = await db.insert(k).values({ tenantId: req.staff!.tenant.id, userId: req.staff!.user.id, name, tokenHash: sha256(token) }).returning();
  res.status(201).json({ id: row.id, name, token });
}));
extTokensRouter.delete('/:id', h(async (req, res) => {
  staffOnly(req);
  const [row] = await db.update(k).set({ revokedAt: new Date() }).where(and(eq(k.id, req.params.id), eq(k.userId, req.staff!.user.id))).returning();
  if (!row) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));

/** The extension folder, zipped on request (Load unpacked in Chrome). */
const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../extension');
export const extDownload = [requireStaff, h(async (_req, res) => {
  const zip = new JSZip();
  const add = async (dir: string, prefix: string) => {
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name);
      if ((await stat(full)).isDirectory()) await add(full, `${prefix}${name}/`);
      else zip.file(`complydesk-extension/${prefix}${name}`, await readFile(full));
    }
  };
  await add(EXT_DIR, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="complydesk-extension.zip"');
  res.send(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
})];
