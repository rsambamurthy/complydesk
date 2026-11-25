# MCA form data packs

MCA V3 forms are web forms filled on the portal (enter the CIN and the portal pre-fills the registration details). For each filing that has a pack, ComplyDesk lays out every field of the form in the form's own order and wording, filled from the records, so the team copies values in rather than looking them up.

Open it from the filing (**Open … form data**) or `/filings/:id/form`. Each field shows where its value comes from:
- **From records** — client details, directors & KMP, register of members, auditor, AGM dates, meetings held. A missing one links to where to fix it.
- **Client profile** — typed once and reused every year (PAN, telephone, website, business activity codes).
- **This filing** — typed for this filing only (turnover, net worth, reason for cessation, shares allotted…).

Tables (shareholders, directors & KMP at year end, changes in the year, meetings and attendance) have a **Copy** button that copies them tab-separated, ready to paste into MCA's Excel templates. **Download Excel** gives the whole pack; **Print** a clean copy. The attachments to upload are listed at the end. Empty fields show in the pre-filing check.

| Pack | Rule codes | Notes |
|---|---|---|
| MGT-7 / MGT-7A | MGT7, MGT7A, MGT7A_OPC | Parts I–XI; AGM due date (31 Dec for the first FY); MGT-8 flagged when paid-up ≥ ₹10 cr or turnover ≥ ₹50 cr |
| AOC-4 | AOC4, AOC4_OPC | Part A, auditor, key figures; CSR annexure flagged on s.135 thresholds |
| DIR-12 | DIR12 | Purpose from the director's dates; category; reason for cessation; attachments by purpose |
| ADT-1 | ADT1 | Auditor, term, appointment date |
| PAS-3 | PAS3 | Allotment details; amount = shares × (nominal + premium); extra attachments for private placement / non-cash |

Not filled automatically (yet): uploading to MCA — V3 has no public filing API; a browser extension that fills the portal from the pack is the next step.

Code: specs as data in `server/src/eforms/forms.ts`; pure builder `eforms/build.ts` (tested in `tests/eforms.test.ts`); `services/eforms.ts` (context, save inputs, Excel); routes `GET/PUT /api/obligations/:id/form`, `GET /api/obligations/:id/form.xlsx`; web `pages/FormPack.tsx`. Add a form = one spec in forms.ts + a test.
