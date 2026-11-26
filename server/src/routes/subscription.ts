/**
 * /api/subscription — the firm's own plan & payment (tenant.settings). Mounted without requireWritable: a lapsed,
 * read-only workspace must still be able to pay. The Razorpay webhook (raw body, signature) is mounted separately.
 */
import { Router, raw } from 'express';
import { h, HttpError } from '../lib/core.js';
import { requirePerm } from '../auth/session.js';
import { parse } from '../lib/parse.js';
import { webhookSignatureOk, gatewayMode, mockSign } from '../lib/razorpay.js';
import { billingDetailsInput, confirmCheckout, confirmInput, handleWebhook, invoice, saveBillingDetails, startCheckout, summary } from '../services/subscription.js';
import { z } from 'zod';

export const subscriptionRouter = Router();
const tid = (req: any) => req.staff.tenant.id as string;

subscriptionRouter.get('/', requirePerm('tenant.settings'), h(async (req, res) => res.json(await summary(tid(req)))));
subscriptionRouter.put('/billing-details', requirePerm('tenant.settings'), h(async (req, res) => { await saveBillingDetails(tid(req), parse(billingDetailsInput, req.body)); res.json(await summary(tid(req))); }));
subscriptionRouter.post('/checkout', requirePerm('tenant.settings'), h(async (req, res) =>
  res.json(await startCheckout(tid(req), parse(z.object({ plan: z.string().min(2) }), req.body).plan, req.staff!.user))));
subscriptionRouter.post('/confirm', requirePerm('tenant.settings'), h(async (req, res) => res.json(await confirmCheckout(tid(req), parse(confirmInput, req.body)))));
/** Mock driver only: stands in for Razorpay's checkout window (tests, smokes, local dev). */
subscriptionRouter.post('/mock-pay', requirePerm('tenant.settings'), h(async (req, res) => {
  if (gatewayMode() !== 'mock') throw new HttpError(404, 'No such API');
  const { orderId } = parse(z.object({ orderId: z.string() }), req.body);
  const paymentId = `pay_mock_${Date.now().toString(36)}`;
  res.json({ orderId, paymentId, signature: mockSign(orderId, paymentId) });
}));
// Any signed-in firm user may open their firm's invoice (it is emailed to the contact anyway).
subscriptionRouter.get('/invoices/:id', h(async (req, res) => res.json(await invoice(req.params.id, tid(req)))));

/** POST /api/razorpay/webhook — no session, no CSRF header; trusted only by its signature over the raw body. */
export const razorpayWebhook = [raw({ type: '*/*', limit: '256kb' }), h(async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!webhookSignatureOk(body, req.get('x-razorpay-signature') ?? '')) throw new HttpError(400, 'Bad signature');
  let json: unknown;
  try { json = JSON.parse(body); } catch { throw new HttpError(400, 'Bad body'); }
  res.json(await handleWebhook(json));
})];
