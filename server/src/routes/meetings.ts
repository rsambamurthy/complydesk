/** Meetings API: routes check permission and client visibility; the work is in services/meetings.ts. */
import { Router } from 'express';
import { draftDailyLimit, draftExplanatoryAi, draftItemAi, draftMinutesAi, draftingEnabled } from '../services/meetingAi.js';
import { z } from 'zod';
import { h, audit } from '../lib/core.js';
import { requirePerm, clientScope, assertClientVisible } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import * as svc from '../services/meetings.js';

export const meetingsRouter = Router();
const tid = (req: any) => req.staff.tenant.id as string;
const view = requirePerm('clients.view');
const work = requirePerm('compliance.work');
const date = z.object({ on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'), shorterNotice: z.boolean().optional() });
/** Loads the meeting and checks the user may see its client. */
const visible = async (req: any) => { const x = await svc.getMeeting(tid(req), req.params.id); assertClientVisible(req, x.clientId); return x; };

meetingsRouter.get('/', view, h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  if (q.clientId) assertClientVisible(req, q.clientId);
  res.json(await svc.listMeetings(tid(req), { clientId: q.clientId, clientIds: clientScope(req), view: (q.view as svc.View) ?? 'upcoming' }));
}));
meetingsRouter.post('/', work, h(async (req, res) => {
  const b = parse(svc.meetingInput, req.body);
  assertClientVisible(req, b.clientId);
  const x = await svc.createMeeting(tid(req), b, req.staff!.user.email);
  await audit(req, 'meeting.create', 'meeting', x.id, b);
  res.status(201).json(x);
}));
meetingsRouter.get('/:id', view, h(async (req, res) => { await visible(req); res.json(await svc.meetingDetail(tid(req), req.params.id)); }));
meetingsRouter.patch('/:id', work, h(async (req, res) => { await visible(req); res.json(await svc.updateMeeting(tid(req), req.params.id, parse(svc.meetingPatch, req.body))); }));

meetingsRouter.post('/:id/items', work, h(async (req, res) => { await visible(req); res.status(201).json(await svc.addItem(tid(req), req.params.id, parse(svc.itemInput, req.body))); }));
meetingsRouter.patch('/items/:itemId', work, h(async (req, res) => {
  const x = await svc.updateItem(tid(req), req.params.itemId, parse(svc.itemPatch, req.body));
  if (req.body.outcome) await audit(req, 'meeting.outcome', 'meeting_item', x.id, { outcome: req.body.outcome });
  res.json(x);
}));
meetingsRouter.post('/items/:itemId/move', work, h(async (req, res) => { await svc.moveItem(tid(req), req.params.itemId, req.body.dir === -1 ? -1 : 1); res.json({ ok: true }); }));
meetingsRouter.delete('/items/:itemId', work, h(async (req, res) => { await svc.removeItem(tid(req), req.params.itemId); res.json({ ok: true }); }));

meetingsRouter.put('/:id/attendance', work, h(async (req, res) => { await visible(req); await svc.setAttendance(tid(req), req.params.id, parse(svc.attendanceInput, req.body)); res.json({ ok: true }); }));
meetingsRouter.post('/:id/notice-sent', work, h(async (req, res) => { await visible(req); const b = parse(date, req.body); res.json(await svc.markNoticeSent(tid(req), req.params.id, b.on, b.shorterNotice)); }));
meetingsRouter.post('/:id/held', work, h(async (req, res) => {
  await visible(req);
  const x = await svc.markHeld(tid(req), req.params.id, parse(date, req.body).on);
  await audit(req, 'meeting.held', 'meeting', x.id, { heldOn: x.heldOn });
  res.json(x);
}));
// AI drafting (drafts only — the CS reviews and saves)
meetingsRouter.get('/ai/status', view, h(async (_req, res) => res.json({ enabled: draftingEnabled(), dailyLimit: draftDailyLimit() })));
meetingsRouter.post('/:id/minutes-ai', work, h(async (req, res) => {
  await visible(req);
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 20000) : undefined;
  res.json(await draftMinutesAi(tid(req), req.staff!.user.id, req.params.id, notes));
}));
meetingsRouter.post('/:id/items/draft', work, h(async (req, res) => { await visible(req); res.json(await draftItemAi(tid(req), req.staff!.user.id, req.params.id, String(req.body?.description ?? ''))); }));
meetingsRouter.post('/items/:itemId/explanatory-ai', work, h(async (req, res) => res.json(await draftExplanatoryAi(tid(req), req.staff!.user.id, req.params.itemId))));
meetingsRouter.get('/:id/minutes-draft', view, h(async (req, res) => { await visible(req); res.json({ text: await svc.draftMinutes(tid(req), req.params.id) }); }));
meetingsRouter.put('/:id/minutes', work, h(async (req, res) => { await visible(req); res.json(await svc.saveMinutes(tid(req), req.params.id, String(req.body?.text ?? ''))); }));
meetingsRouter.post('/:id/minutes-signed', work, h(async (req, res) => {
  await visible(req);
  const x = await svc.signMinutes(tid(req), req.params.id, parse(date, req.body).on);
  await audit(req, 'meeting.minutes_signed', 'meeting', x.id, { on: x.minutesSignedOn });
  res.json(x);
}));
meetingsRouter.post('/:id/cancel', work, h(async (req, res) => { await visible(req); res.json(await svc.cancelMeeting(tid(req), req.params.id)); }));
