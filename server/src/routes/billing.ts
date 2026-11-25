/** Fees and billing. Viewing: billing.view; changes: billing.manage. Client users never see billing. */
import { Router } from 'express';
import { h, audit, HttpError } from '../lib/core.js';
import { requirePerm } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { GST_STATES } from '../billing/calc.js';
import {
  addPayment, billingSummary, cancelInvoice, clientBilling, clientBillingInput, createInput, createInvoice, deleteDraft, draftInput, feeList, feesInput,
  invoiceDetail, invoiceList, issueInvoice, paymentInput, profileInput, profileOf, removePayment, saveClientBilling, saveFees, saveProfile, unbilled, updateDraft,
} from '../services/billing.js';

export const billingRouter = Router();
const view = requirePerm('billing.view');
const manage = requirePerm('billing.manage');
billingRouter.use((req, _res, next) => (req.staff?.user.clientIds.length ? next(new HttpError(403, 'You don’t have permission to do this')) : next()));
const T = (req: any) => req.staff.tenant;
const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

billingRouter.get('/states', view, h(async (_req, res) => res.json(Object.entries(GST_STATES).map(([code, name]) => ({ code, name })))));
billingRouter.get('/profile', view, h(async (req, res) => res.json(profileOf(T(req)))));
billingRouter.put('/profile', manage, h(async (req, res) => {
  const b = parse(profileInput, req.body);
  const out = await saveProfile(T(req), b);
  await audit(req, 'billing.profile', 'tenant', T(req).id, b);
  res.json(out);
}));
billingRouter.get('/summary', view, h(async (req, res) => res.json(await billingSummary(T(req), q(req.query.clientId)))));
billingRouter.get('/unbilled', view, h(async (req, res) => res.json(await unbilled(T(req), q(req.query.clientId)))));

billingRouter.get('/fees', view, h(async (req, res) => res.json(await feeList(T(req).id, q(req.query.clientId)))));
billingRouter.put('/fees', manage, h(async (req, res) => {
  const clientId = q(req.query.clientId) ?? null;
  const out = await saveFees(T(req).id, clientId, parse(feesInput, req.body));
  await audit(req, 'billing.fees', clientId ? 'client' : 'tenant', clientId ?? T(req).id, req.body);
  res.json(out);
}));
billingRouter.get('/clients/:id', view, h(async (req, res) => res.json(await clientBilling(T(req).id, req.params.id))));
billingRouter.put('/clients/:id', manage, h(async (req, res) => {
  const b = parse(clientBillingInput, req.body);
  const out = await saveClientBilling(T(req).id, req.params.id, b);
  await audit(req, 'billing.client', 'client', req.params.id, b);
  res.json(out);
}));

billingRouter.get('/invoices', view, h(async (req, res) => res.json(await invoiceList(T(req).id, { clientId: q(req.query.clientId), status: q(req.query.status), open: req.query.open === '1' }))));
billingRouter.post('/invoices', manage, h(async (req, res) => {
  const out = await createInvoice(T(req), req.staff!.user.id, parse(createInput, req.body));
  await audit(req, 'invoice.create', 'invoice', out.id, { clientId: out.clientId });
  res.status(201).json(out);
}));
billingRouter.get('/invoices/:id', view, h(async (req, res) => res.json(await invoiceDetail(T(req).id, req.params.id))));
billingRouter.put('/invoices/:id', manage, h(async (req, res) => {
  const out = await updateDraft(T(req), req.params.id, parse(draftInput, req.body));
  await audit(req, 'invoice.update', 'invoice', out.id);
  res.json(out);
}));
billingRouter.delete('/invoices/:id', manage, h(async (req, res) => {
  const i = await deleteDraft(T(req).id, req.params.id);
  await audit(req, 'invoice.delete', 'invoice', i.id);
  res.json({ ok: true });
}));
billingRouter.post('/invoices/:id/issue', manage, h(async (req, res) => {
  const out = await issueInvoice(T(req), req.params.id);
  await audit(req, 'invoice.issue', 'invoice', out.id, { number: out.number, total: out.total });
  res.json(out);
}));
billingRouter.post('/invoices/:id/cancel', manage, h(async (req, res) => {
  const out = await cancelInvoice(T(req).id, req.params.id, String(req.body?.reason ?? ''));
  await audit(req, 'invoice.cancel', 'invoice', out.id, { number: out.number, reason: req.body?.reason });
  res.json(out);
}));
billingRouter.post('/invoices/:id/payments', manage, h(async (req, res) => {
  const b = parse(paymentInput, req.body);
  const out = await addPayment(T(req).id, req.staff!.user.id, req.params.id, b);
  await audit(req, 'payment.create', 'invoice', out.id, b);
  res.status(201).json(out);
}));
billingRouter.delete('/payments/:id', manage, h(async (req, res) => {
  const out = await removePayment(T(req).id, req.params.id);
  await audit(req, 'payment.delete', 'invoice', out.id, { paymentId: req.params.id });
  res.json(out);
}));
