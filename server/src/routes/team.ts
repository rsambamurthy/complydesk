/** Team workload (team.view) and time entries (any firm staff member logs their own). */
import { Router } from 'express';
import { h, audit, HttpError } from '../lib/core.js';
import { requirePerm } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { fyOf, fyStart, todayIst } from '../compliance/dates.js';
import { addTime, hoursByClient, monthStart, removeTime, teamWorkload, timeInput, timeList } from '../services/workload.js';

export const teamRouter = Router();
const D = /^\d{4}-\d{2}-\d{2}$/;
/** ?period=month|last|fy, or ?from=&to= */
function range(q: any) {
  const today = todayIst();
  if (D.test(q.from ?? '') && D.test(q.to ?? '')) return { from: q.from, to: q.to };
  if (q.period === 'last') { const first = monthStart(today); const d = new Date(`${first}T00:00:00Z`); d.setUTCDate(0); const end = d.toISOString().slice(0, 10); return { from: monthStart(end), to: end }; }
  if (q.period === 'fy') return { from: fyStart(fyOf(today)), to: today };
  return { from: monthStart(today), to: today };
}
const staffOnly = (req: any, _res: any, next: any) => (req.staff?.user.clientIds.length ? next(new HttpError(403, 'For the firm’s team')) : next());
teamRouter.use(staffOnly);

teamRouter.get('/workload', requirePerm('team.view'), h(async (req, res) => { const r = range(req.query); res.json({ ...(await teamWorkload(req.staff!.tenant, r.from, r.to)), clients: await hoursByClient(req.staff!.tenant, r.from, r.to) }); }));
teamRouter.get('/time', requirePerm('compliance.work'), h(async (req, res) => {
  const q = req.query as Record<string, string>;
  // Without team.view you see only your own time (and a filing's time).
  const userId = req.staff!.permissions.has('team.view') ? q.userId : q.obligationId ? undefined : req.staff!.user.id;
  res.json(await timeList(req.staff!.tenant.id, { clientId: q.clientId, obligationId: q.obligationId, userId, from: D.test(q.from ?? '') ? q.from : undefined, to: D.test(q.to ?? '') ? q.to : undefined }));
}));
teamRouter.post('/time', requirePerm('compliance.work'), h(async (req, res) => {
  const row = await addTime(req.staff!, parse(timeInput, req.body));
  await audit(req, 'time.create', 'time_entry', row.id, { minutes: row.minutes, clientId: row.clientId });
  res.status(201).json(row);
}));
teamRouter.delete('/time/:id', requirePerm('compliance.work'), h(async (req, res) => { await removeTime(req.staff!, req.params.id); res.json({ ok: true }); }));
