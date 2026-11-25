/** Client master and a client's compliance calendar. Routes only check permissions and shape responses. */
import { Router } from 'express';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { db, schema, h, audit } from '../lib/core.js';
import { requirePerm, clientScope, assertClientVisible } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { auditorInput, clientInput, eventInput, personInput, shareholderInput, yearInput, FLAGS, DESIGNATIONS } from '../lib/validators.js';
import { createClient, updateClient, clientDetail, peopleSvc, shareholdersSvc, auditorsSvc, setYear } from '../services/clients.js';
import { addEvent, perClient, summary } from '../services/obligations.js';
import { activeFys, rulesFor } from '../compliance/sync.js';
import { applies } from '../compliance/engine.js';

const { clients, users } = schema;
export const clientsRouter = Router();
const view = requirePerm('clients.view');
const manage = requirePerm('clients.manage');
const tid = (req: any) => req.staff.tenant.id as string;

/** Lists the screens need to build forms (one source for options and labels). */
clientsRouter.get('/meta', view, h(async (req, res) => {
  const rules = await rulesFor(tid(req));
  res.json({
    flags: FLAGS, designations: DESIGNATIONS, fys: activeFys(),
    eventRules: rules.filter((r) => r.due.kind === 'AFTER_EVENT' && r.active !== false).map((r) => ({ code: r.code, form: r.form, title: r.title, event: r.event, days: (r.due as any).days })),
    staff: await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.tenantId, tid(req)), eq(users.status, 'ACTIVE'))).orderBy(users.name),
  });
}));

/** Light search for pickers: name or CIN, at most 20 (or the given ids, to show names of what is already picked). */
clientsRouter.get('/lookup', view, h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 500);
  const scope = clientScope(req);
  const rows = await db.select({ id: clients.id, name: clients.name, cin: clients.cin }).from(clients)
    .where(and(eq(clients.tenantId, tid(req)), eq(clients.status, 'ACTIVE'),
      ids.length ? inArray(clients.id, ids) : q ? or(ilike(clients.name, `%${q}%`), ilike(clients.cin, `%${q}%`)) : undefined,
      scope ? inArray(clients.id, scope.length ? scope : ['-']) : undefined))
    .orderBy(asc(clients.name)).limit(ids.length ? 500 : Math.min(Number(req.query.limit) || 20, 50));
  res.json(rows);
}));

clientsRouter.get('/', view, h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const scope = clientScope(req);
  const rows = await db.select({ c: clients, ownerName: users.name }).from(clients).leftJoin(users, eq(users.id, clients.ownerId))
    .where(and(eq(clients.tenantId, tid(req)), eq(clients.status, req.query.archived ? 'ARCHIVED' : 'ACTIVE'),
      q ? or(ilike(clients.name, `%${q}%`), ilike(clients.cin, `%${q}%`)) : undefined,
      scope ? inArray(clients.id, scope.length ? scope : ['-']) : undefined))
    .orderBy(asc(clients.name));
  const counts = new Map((await perClient(tid(req), scope)).map((x) => [x.clientId, x]));
  res.json(rows.map(({ c, ownerName }) => ({ ...c, ownerName, overdue: counts.get(c.id)?.overdue ?? 0, due30: counts.get(c.id)?.due30 ?? 0, nextDue: counts.get(c.id)?.nextDue ?? null })));
}));

clientsRouter.post('/', manage, h(async (req, res) => {
  const c = await createClient(tid(req), parse(clientInput, req.body));
  await audit(req, 'client.create', 'client', c.id, { cin: c.cin });
  res.status(201).json(c);
}));

clientsRouter.get('/:id', view, h(async (req, res) => {
  assertClientVisible(req, req.params.id);
  const d = await clientDetail(tid(req), req.params.id);
  // Which rules apply and why not — shown on the client's Compliance tab.
  const rules = await rulesFor(tid(req));
  const aud = d.auditors.find((a) => a.current);
  const fy = activeFys()[1];
  const ruleView = rules.filter((r) => r.due.kind !== 'AFTER_EVENT').map((r) => ({
    code: r.code, form: r.form, title: r.title,
    applies: applies(r, { client: { ...d.client, flags: d.client.flags }, auditorTermToFy: aud?.termToFy ?? null, fy }),
  }));
  res.json({ ...d, summary: await summary(tid(req), { clientId: req.params.id }), rules: ruleView });
}));

clientsRouter.patch('/:id', manage, h(async (req, res) => {
  const body = parse(clientInput.innerType().partial(), req.body);
  const c = await updateClient(tid(req), req.params.id, body);
  await audit(req, 'client.update', 'client', c.id, req.body);
  res.json(c);
}));

clientsRouter.post('/:id/archive', manage, h(async (req, res) => {
  const c = await updateClient(tid(req), req.params.id, { status: req.body.archived === false ? 'ACTIVE' : 'ARCHIVED' });
  await audit(req, 'client.archive', 'client', c.id, { status: c.status });
  res.json(c);
}));

clientsRouter.put('/:id/years/:fy', manage, h(async (req, res) => {
  const r = await setYear(tid(req), req.params.id, Number(req.params.fy), parse(yearInput, req.body));
  await audit(req, 'client.year', 'client', req.params.id, { fy: req.params.fy, ...req.body });
  res.json(r);
}));

clientsRouter.post('/:id/events', requirePerm('compliance.work'), h(async (req, res) => {
  assertClientVisible(req, req.params.id);
  const x = await addEvent(tid(req), req.params.id, parse(eventInput, req.body));
  await audit(req, 'obligation.event', 'obligation', x.id, req.body);
  res.status(201).json(x);
}));

/** People, shareholders and auditors share one set of routes. */
const children = [
  { path: 'people', svc: peopleSvc, input: personInput.innerType() },
  { path: 'shareholders', svc: shareholdersSvc, input: shareholderInput },
  { path: 'auditors', svc: auditorsSvc, input: auditorInput },
] as const;
for (const c of children) {
  const full = c.path === 'people' ? personInput : c.input;
  clientsRouter.post(`/:id/${c.path}`, manage, h(async (req, res) => {
    const row = await c.svc.add(tid(req), req.params.id, parse(full, req.body));
    await audit(req, `${c.path}.create`, c.path, (row as any).id, req.body);
    res.status(201).json(row);
  }));
  clientsRouter.patch(`/${c.path}/:rowId`, manage, h(async (req, res) => {
    const row = await c.svc.update(tid(req), req.params.rowId, parse(full, req.body));
    await audit(req, `${c.path}.update`, c.path, req.params.rowId, req.body);
    res.json(row);
  }));
  clientsRouter.delete(`/${c.path}/:rowId`, manage, h(async (req, res) => {
    await c.svc.remove(tid(req), req.params.rowId);
    await audit(req, `${c.path}.delete`, c.path, req.params.rowId);
    res.json({ ok: true });
  }));
}
