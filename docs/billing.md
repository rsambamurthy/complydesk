# Fees and billing

Permissions `billing.view` / `billing.manage` (Firm Admin and Partner by default; migration 0011 grants them to existing workspaces). Client users never see billing.

- **Firm details** — `tenants.settings.billing` (`BillingProfile`): name, GSTIN (no GSTIN → no GST), PAN, address, state, SAC, rate (default 18), prefix (≤ 5 chars), due days, bank details, terms, `billFrom`.
- **Fees** — `fees` table: firm default per rule code (`client_id` null) and a client's own fee. `feeFor` = client's → firm's → none.
- **Client billing details** — `clients.billing` (`ClientBilling`): bill-to name, GSTIN, address, state, email, retainer.
- **To be billed** — obligations with status FILED (stage FILED / APPROVED), filed on/after `billFrom`, not on a live (non-cancelled) invoice line.
- **Invoices** — `invoices` + `invoice_lines` (+ `payments`). Draft → **issue** (number `PREFIX/YY-YY/NNN`, consecutive per FY under a row lock; firm and bill-to details frozen) → payments (amount + TDS) → paid. Cancel (with a reason, no payments) keeps the number; its filings return to to-be-billed. Drafts can be deleted.
- **GST** — pure `server/src/billing/calc.ts`: place of supply = client GSTIN state → state entered → CIN state letters; same state as the firm → CGST + SGST (half rate each), else IGST; reimbursement lines (`taxable: false`) carry no GST. Amount in words (Indian system), balance (payments + TDS), ageing buckets. Tested in `tests/billing.test.ts`.
- **Service** `services/billing.ts`, routes `routes/billing.ts` (`/api/billing`). Web: `pages/Billing.tsx` (tiles, ageing, tabs), `pages/InvoiceDetail.tsx`, `pages/InvoicePrint.tsx`; shared pieces in `components/Billing.tsx` (also the client's Billing tab).
- Invoice dates use India time (`todayIst`).
- Smoke: `scripts/smoke-billing.ts`.

Not yet: credit notes, e-invoicing (IRN) for firms above the threshold, emailing invoices, online payment links.
