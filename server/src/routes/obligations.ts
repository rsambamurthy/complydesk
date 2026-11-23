import { Router } from 'express';
import { db, schema, h, audit } from '../lib/core.js';
import { requirePerm, clientScope, assertClientVisible } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { obligationPatch } from '../lib/validators.js';
import { listObligations, summary, updateObligation, getObligation, removeManual, perClient, type Bucket } from '../services/obligations.js';
import { and, eq, inArray } from 'drizzle-orm';

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

obligationsRouter.patch('/:id', requirePerm('compliance.work'), h(async (req, res) => {
  const cur = await getObligation(tid(req), req.params.id);
  assertClientVisible(req, cur.clientId);
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
