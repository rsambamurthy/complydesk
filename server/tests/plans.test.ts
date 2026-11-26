import { describe, it, expect, beforeAll } from 'vitest';
import { DEFAULT_PLANS, quote, withGst, yearEnd, limitsFor, daysBetween } from '../src/platform/plans.js';

const [starter, growth, practice, firm] = DEFAULT_PLANS;
const none = { plan: null, paidUntil: null, clients: 10, users: 3 };

describe('plans: quote', () => {
  it('a trial firm buys a year from today', () => {
    const q = quote(practice, none, DEFAULT_PLANS, '2026-11-26');
    expect(q).toMatchObject({ ok: true, kind: 'NEW', from: '2026-11-26', to: '2027-11-25', amount: 30000 });
  });
  it('a year ends the day before the anniversary, across a leap day', () => {
    expect(yearEnd('2027-03-01')).toBe('2028-02-29');
    expect(daysBetween('2026-11-26', '2027-11-25')).toBe(364);
  });
  it('renewing the same plan starts the day after the current end', () => {
    const q = quote(starter, { ...none, plan: 'STARTER', paidUntil: '2027-01-10' }, DEFAULT_PLANS, '2026-12-20');
    expect(q).toMatchObject({ ok: true, kind: 'RENEW', from: '2027-01-11', to: '2028-01-10', amount: 12000 });
  });
  it('a lapsed subscription renews from today', () => {
    const q = quote(starter, { ...none, plan: 'STARTER', paidUntil: '2026-10-31' }, DEFAULT_PLANS, '2026-11-26');
    expect(q).toMatchObject({ ok: true, kind: 'RENEW', from: '2026-11-26' });
  });
  it('an upgrade pays the difference for the days left, to the same end', () => {
    // 100 days left (2026-11-26 .. 2027-03-05), difference 18,000 a year
    const q = quote(practice, { ...none, plan: 'STARTER', paidUntil: '2027-03-05' }, DEFAULT_PLANS, '2026-11-26');
    expect(q).toMatchObject({ ok: true, kind: 'UPGRADE', to: '2027-03-05', amount: Math.round(18000 * 100 / 365) });
  });
  it('a smaller plan waits for renewal time, then renews', () => {
    const cur = { ...none, plan: 'FIRM', paidUntil: '2027-06-30' };
    expect(quote(starter, cur, DEFAULT_PLANS, '2026-11-26').ok).toBe(false);
    expect(quote(starter, cur, DEFAULT_PLANS, '2027-06-10')).toMatchObject({ ok: true, kind: 'RENEW', from: '2027-07-01' });
  });
  it('a plan smaller than what is in use is refused', () => {
    const q = quote(starter, { ...none, clients: 40 }, DEFAULT_PLANS, '2026-11-26');
    expect(q).toMatchObject({ ok: false });
    expect((q as any).reason).toContain('40 client companies');
    expect(quote(firm, { ...none, users: 41 }, DEFAULT_PLANS, '2026-11-26').ok).toBe(false);
  });
  it('a 30-client firm can take Growth but not Starter', () => {
    const cur = { ...none, clients: 30, users: 6 };
    expect(quote(starter, cur, DEFAULT_PLANS, '2026-11-26').ok).toBe(false);
    expect(quote(growth, cur, DEFAULT_PLANS, '2026-11-26')).toMatchObject({ ok: true, amount: 20000 });
  });
  it('a withdrawn plan is not sold', () => {
    expect(quote({ ...practice, active: false }, none, DEFAULT_PLANS, '2026-11-26').ok).toBe(false);
  });
});

describe('plans: GST and limits', () => {
  it('CGST + SGST inside the state, IGST outside', () => {
    expect(withGst(30000, '33', '33')).toEqual({ amount: 30000, cgst: 2700, sgst: 2700, igst: 0, total: 35400 });
    expect(withGst(30000, '33', '29')).toEqual({ amount: 30000, cgst: 0, sgst: 0, igst: 5400, total: 35400 });
  });
  it('trial uses the trial limit, a plan its own, old workspaces none', () => {
    expect(limitsFor({ status: 'TRIAL', plan: null }, DEFAULT_PLANS, 10)).toEqual({ clients: 10, users: null });
    expect(limitsFor({ status: 'ACTIVE', plan: 'STARTER' }, DEFAULT_PLANS, 10)).toEqual({ clients: 25, users: 5 });
    expect(limitsFor({ status: 'ACTIVE', plan: null }, DEFAULT_PLANS, 10)).toEqual({ clients: null, users: null });
  });
});

describe('razorpay signatures', () => {
  let rz: typeof import('../src/lib/razorpay.js');
  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_abc'; process.env.RAZORPAY_KEY_SECRET = 'sekret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'hooksecret';
    rz = await import('../src/lib/razorpay.js');
  });
  it('checks the checkout signature (order_id|payment_id)', () => {
    const sig = rz.hmac('sekret', 'order_1|pay_1');
    expect(rz.paymentSignatureOk('order_1', 'pay_1', sig)).toBe(true);
    expect(rz.paymentSignatureOk('order_1', 'pay_2', sig)).toBe(false);
    expect(rz.paymentSignatureOk('order_1', 'pay_1', 'x')).toBe(false);
  });
  it('checks the webhook signature over the raw body', () => {
    const body = '{"event":"order.paid"}';
    expect(rz.webhookSignatureOk(body, rz.hmac('hooksecret', body))).toBe(true);
    expect(rz.webhookSignatureOk(body + ' ', rz.hmac('hooksecret', body))).toBe(false);
    expect(rz.gatewayMode()).toBe('test');
  });
});
