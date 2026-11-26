# Subscriptions (firms paying Integrata for ComplyDesk)

## Pieces
- `server/src/platform/plans.ts` — pure: `Plan`, `Seller`, `DEFAULT_PLANS` (Starter 25 clients / 5 users ₹12,000; Practice 100 / 20 ₹30,000; Firm 300 / 40 ₹75,000 — per year, before GST), `quote()` (NEW / RENEW / UPGRADE / refused), `withGst()` (via `billing/calc.ts invoiceTotals`), `limitsFor()`, `RENEWAL_REMINDER_DAYS`. Tested in `tests/plans.test.ts`.
- `server/src/lib/razorpay.ts` — Orders API (`createOrder`), checkout signature `HMAC_SHA256(order_id|payment_id, key secret)`, webhook signature `HMAC_SHA256(raw body, webhook secret)`. `PAYMENTS_DRIVER=mock` makes orders/signatures locally.
- `server/src/services/subscription.ts` — plans & seller (platform settings), usage and limits (`assertClientCapacity`, `assertUserCapacity`), `summary`, billing details, `startCheckout`, `confirmCheckout`, `handleWebhook`, `recordOffline`, `markPaid` (the only place a payment becomes real), `invoice` (same shape as a firm's own invoice so `web/src/pages/InvoicePrint.tsx` prints both), `runRenewalReminders` (daily 04:00 UTC in `jobs.ts`).
- Table `subscription_payments` (CREATED → PAID; ONLINE / OFFLINE; invoice number unique), tenant columns `plan`, `billing_address`, `billing_state`; platform settings `plans`, `seller`.
- Routes: `/api/subscription` (tenant.settings; **not** behind requireWritable — a lapsed workspace must be able to pay), `POST /api/razorpay/webhook` (raw body, before the JSON parser and CSRF check, trusted only by signature), platform `/api/platform/plans`, `/seller`, `/payments`, `/payments/:id`, `/tenants/:id/payments`.
- Web: `pages/admin/Subscription.tsx` (Administration → Plan & payment; loads Razorpay `checkout.js` on demand; a modal stands in for it with the mock driver), `pages/PlatformSubscriptions.tsx` (Integrata → Plans & payments), Record a payment in `pages/Platform.tsx`, trial / read-only bar links in `Shell.tsx`.

## Rules
- Paying with no paid period running (trial, lapsed, or active without an end date) buys a year from today; the same plan (or a smaller one within 30 days of the end) renews from the day after the end; a bigger plan pays `(new − old) × days left / 365` and keeps the end date. A plan smaller than the clients or team members in use is refused.
- `paidUntil` is the end of that day in India. Read-only follows 7 days after it (`accessState`).
- `markPaid` is idempotent (row lock + advisory lock for the invoice series). A renewal paid after another payment already moved the end date starts after the new end. Invoice numbers: `<prefix>/<FY>/<seq>` from Integrata's invoice prefix (default CDX).
- The webhook checks the amount against the order before marking it paid.
- Limits: trial → trial client limit; a plan → its limits; an active workspace without a plan (activated by hand before plans) → none. Client-portal users never count.

## Going live (Integrata)
1. In Razorpay: activate the account, create API keys (test first, then live), and a webhook to `https://<app>/api/razorpay/webhook` for `order.paid` and `payment.captured` with a secret.
2. In Railway set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (never commit them).
3. Platform console → Plans & payments: Integrata's legal name, GSTIN, address, state, SAC, invoice prefix; check the prices.
4. Pay once with a `rzp_test_` key (the page shows "test mode"), then switch to live keys.

Smoke: `scripts/smoke-subscription.ts` (API with `PAYMENTS_DRIVER=mock`).
