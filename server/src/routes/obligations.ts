import { Router } from 'express';
import { z } from 'zod';
import { reviewFor, checkDraft } from '../services/review.js';
import { db, schema, h, audit } from '../lib/core.js';
import { requirePerm, clientScope, assertClientVisible } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { obligationPatch } from '../lib/validators.js';
import { listObligations, summary, updateObligation, getObligation, removeManual, perClient, type Bucket } from '../services/obligations.js';
import { and, eq, inArray } from 'drizzle-orm';
import { HttpError } from '../lib/core.js';
import { move, moveInput, movesFor, history } from '../services/workflow.js';
import { isMeeting } from '../services/stages.js';
import { settingsOf } from '../lib/settings.js';

export const obligationsRouter = Router();
const tid = (req: any) => req.staff.tenant.id as string;

obligationsRouter.get('/', requirePerm('clients.view'), h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  if (q.clientId) assertClientVisible(req, q.clientId);
  res.json(await listObligations(tid(req), {
    bucket: (q.bucket as Bucket) ?? 'open', clientId: q.clientId, clientIds: clientScope(req),
    assigneeId: q.assignee === 'me' ? req.staff!.user.id : q.assignee || undefined, form: q.form, fy: q.fy ? Number(q.fy) : undefined,
  }));
}));

/** Dashboard: counts for the workspace and for me, and the clients needing attention. */
obligationsRouter.get('/dashboard', requirePerm('clients.view'), h(async (req, res) => {
  const scope = clientScope(req);
  const [all, mine, per] = await Promise.all([
    summary(tid(req), { clientIds: scope }),
    summary(tid(req), { clientIds: scope, assigneeId: req.staff!.user.id }),
    perClient(tid(req), scope),
  ]);
  const { clients } = schema;
  const ids = per.filter((p) => p.overdue || p.due30).map((p) => p.clientId);
  const names = ids.length ? await db.select({ id: clients.id, name: clients.name, cin: clients.cin }).from(clients).where(and(eq(clients.tenantId, tid(req)), inArray(clients.id, ids))) : [];
  const attention = names.map((n) => ({ ...n, ...per.find((p) => p.clientId === n.id)! }))
    .sort((a, b) => b.overdue - a.overdue || b.due30 - a.due30).slice(0, 10);
  res.json({ all, mine, attention });
}));

/** One filing with what this person can do next, its history and who prepared / reviewed / approved it. */
obligationsRouter.get('/:id', requirePerm('clients.view'), h(async (req, res) => {
  const ob = await getObligation(tid(req), req.params.id);
  assertClientVisible(req, ob.clientId);
  const ids = [ob.preparedById, ob.reviewedById, ob.clientApprovedById].filter(Boolean) as string[];
  const names = ids.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids)) : [];
  const nameOf = (id: string | null) => names.find((n) => n.id === id)?.name ?? null;
  res.json({ obligation: ob, moves: await movesFor(ob, req.staff!), history: await history(ob.id), settings: settingsOf(req.staff!.tenant),
    preparedBy: nameOf(ob.preparedById), reviewedBy: nameOf(ob.reviewedById), clientApprovedBy: nameOf(ob.clientApprovedById) });
}));

/** Reviewer check: firm staff only (not client users). */
const reviewer = (req: any) => {
  const p = req.staff!.permissions;
  if (req.staff!.user.clientIds.length || (!p.has('compliance.work') && !p.has('compliance.approve'))) throw new HttpError(403, 'You can’t do this');
};
obligationsRouter.get('/:id/review', h(async (req, res) => {
  reviewer(req);
  const ob = await getObligation(tid(req), req.params.id);
  assertClientVisible(req, ob.clientId);
  res.json(await reviewFor(tid(req), ob.id));
}));
obligationsRouter.post('/:id/review', h(async (req, res) => {
  reviewer(req);
  const ob = await getObligation(tid(req), req.params.id);
  assertClientVisible(req, ob.clientId);
  const { attachmentId } = parse(z.object({ attachmentId: z.string().min(1, 'Pick the draft form') }), req.body);
  const out = await checkDraft(req.staff!, ob.id, attachmentId);
  await audit(req, 'filing.check', 'obligation', ob.id, { attachmentId });
  res.json(out);
}));

obligationsRouter.post('/:id/move', h(async (req, res) => {
  const p = req.staff!.permissions;
  if (!p.has('compliance.work') && !p.has('compliance.client_approve') && !p.has('compliance.approve')) throw new HttpError(403, 'You can’t do this');
  const ob = await getObligation(tid(req), req.params.id);
  assertClientVisible(req, ob.clientId);
  const x = await move(ob, req.staff!, parse(moveInput, req.body));
  await audit(req, `filing.${req.body.action}`, 'obligation', x.id, { stage: x.stage, note: req.body.note });
  res.json(x);
}));

obligationsRouter.patch('/:id', requirePerm('compliance.work'), h(async (req, res) => {
  const cur = await getObligation(tid(req), req.params.id);
  assertClientVisible(req, cur.clientId);
  // A filing is marked filed through the workflow (review, SRN); meetings are marked held from the meeting.
  if (req.body.status && !isMeeting(cur.form) && req.body.status !== cur.status && settingsOf(req.staff!.tenant).requireReview && req.body.status === 'FILED')
    throw new HttpError(400, 'Your firm reviews filings before they’re filed — use the steps in the filing.');
  const x = await updateObligation(tid(req), req.params.id, parse(obligationPatch, req.body));
  await audit(req, 'obligation.update', 'obligation', x.id, req.body);
  res.json(x);
}));

obligationsRouter.delete('/:id', requirePerm('compliance.work'), h(async (req, res) => {
  const cur = await getObligation(tid(req), req.params.id);
  assertClientVisible(req, cur.clientId);
  await removeManual(tid(req), req.params.id);
  await audit(req, 'obligation.delete', 'obligation', req.params.id);
  res.json({ ok: true });
}));
