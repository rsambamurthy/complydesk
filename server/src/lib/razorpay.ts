/**
 * Razorpay for ComplyDesk subscriptions (Orders API + Standard Checkout). Keys come from the environment only:
 * RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET (set by Integrata in Railway).
 * PAYMENTS_DRIVER=mock: orders and signatures are made locally (tests and smokes), no network.
 * Without keys online payment is off and Integrata records payments by hand in the platform console.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const mock = () => process.env.PAYMENTS_DRIVER === 'mock';
const keyId = () => process.env.RAZORPAY_KEY_ID?.trim() || (mock() ? 'rzp_test_mock' : '');
const keySecret = () => process.env.RAZORPAY_KEY_SECRET?.trim() || (mock() ? 'mock_secret' : '');
const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || (mock() ? 'mock_webhook' : '');

export const gatewayEnabled = () => !!(keyId() && keySecret());
export const gatewayMode = () => (mock() ? 'mock' : keyId().startsWith('rzp_test_') ? 'test' : 'live');
export const publicKey = () => keyId();

export const hmac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Checkout's handler gets order id, payment id and this signature: HMAC-SHA256(order_id|payment_id, key secret). */
export const paymentSignatureOk = (orderId: string, paymentId: string, signature: string) =>
  !!keySecret() && same(hmac(keySecret(), `${orderId}|${paymentId}`), signature || '');
/** Webhooks carry X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret). */
export const webhookSignatureOk = (rawBody: string, signature: string) =>
  !!webhookSecret() && same(hmac(webhookSecret(), rawBody), signature || '');
/** For the mock driver only: what Razorpay would have signed. */
export const mockSign = (orderId: string, paymentId: string) => hmac(keySecret(), `${orderId}|${paymentId}`);

export interface Order { id: string; amount: number; currency: string; receipt: string }

/** Creates an order; amount in rupees (sent in paise). */
export async function createOrder(rupees: number, receipt: string, notes: Record<string, string>): Promise<Order> {
  const amount = Math.round(rupees * 100);
  if (mock()) return { id: `order_mock_${randomBytes(6).toString('hex')}`, amount, currency: 'INR', receipt };
  if (!gatewayEnabled()) throw new Error('Online payment is not set up');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString('base64')}` },
    body: JSON.stringify({ amount, currency: 'INR', receipt: receipt.slice(0, 40), notes }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay: ${body?.error?.description ?? res.status}`);
  return { id: body.id, amount: body.amount, currency: body.currency, receipt: body.receipt };
}
