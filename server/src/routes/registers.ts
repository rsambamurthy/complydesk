/** Statutory registers. Viewing: anyone who can see the client. Entries: clients.manage. */
import { Router } from 'express';
import { h, audit } from '../lib/core.js';
import { requirePerm, assertClientVisible } from '../auth/session.js';
import { addEntry, entryClient, registerList, registerView, registersWorkbook, removeEntry, updateEntry } from '../services/registers.js';

export const registersRouter = Router();
const tid = (req: any) => req.staff.tenant.id as string;
const view = requirePerm('clients.view');
const manage = requirePerm('clients.manage');

registersRouter.put('/entries/:id', manage, h(async (req, res) => {
  assertClientVisible(req, await entryClient(tid(req), req.params.id));
  const out = await updateEntry(tid(req), req.params.id, req.body ?? {});
  await audit(req, 'register.update', 'register_entry', req.params.id, { register: out.entry.register });
  res.json(out);
}));
registersRouter.delete('/entries/:id', manage, h(async (req, res) => {
  assertClientVisible(req, await entryClient(tid(req), req.params.id));
  const e = await removeEntry(tid(req), req.params.id);
  await audit(req, 'register.delete', 'register_entry', e.id, { register: e.register, data: e.data });
  res.json({ ok: true });
}));
registersRouter.get('/:clientId/export.xlsx', view, h(async (req, res) => {
  assertClientVisible(req, req.params.clientId);
  const { buffer, fileName } = await registersWorkbook(tid(req), req.params.clientId, req.query.code ? String(req.query.code) : undefined);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
}));
registersRouter.get('/:clientId', view, h(async (req, res) => {
  assertClientVisible(req, req.params.clientId);
  res.json(await registerList(tid(req), req.params.clientId));
}));
registersRouter.get('/:clientId/:code', view, h(async (req, res) => {
  assertClientVisible(req, req.params.clientId);
  res.json(await registerView(tid(req), req.params.clientId, req.params.code));
}));
registersRouter.post('/:clientId/:code/entries', manage, h(async (req, res) => {
  assertClientVisible(req, req.params.clientId);
  const out = await addEntry(tid(req), req.staff!.user.id, req.params.clientId, req.params.code, req.body ?? {});
  await audit(req, 'register.create', 'register_entry', out.entry.id, { register: req.params.code });
  res.status(201).json(out);
}));
