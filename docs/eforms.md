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
| AOC-4 | AOC4, AOC4_OPC | Part A, auditor; Part B = every Schedule III line, current and previous year (`fs.<line>.cy/py`, read from the statements or typed); CSR annexure flagged on s.135 thresholds (net worth, turnover, profit from the lines) |
| AOC-4 XBRL | AOC4_XBRL | Same data; table *XBRL working paper* for the XBRL tool; attachments = instance document + human-readable PDF from MCA's validation tool. ComplyDesk does not generate the instance document (needs MCA's taxonomy and validation tool). |
| DIR-12 | DIR12 | Purpose from the director's dates; category; reason for cessation; attachments by purpose |
| ADT-1 | ADT1 | Auditor, term, appointment date |
| PAS-3 | PAS3 | Allotment details; amount = shares × (nominal + premium); extra attachments for private placement / non-cash |

Not filled automatically (yet): uploading to MCA — V3 has no public filing API; a browser extension that fills the portal from the pack is the next step.

Code: specs as data in `server/src/eforms/forms.ts`; pure builder `eforms/build.ts` (tested in `tests/eforms.test.ts`); `services/eforms.ts` (context, save inputs, Excel); routes `GET/PUT /api/obligations/:id/form`, `GET /api/obligations/:id/form.xlsx`; web `pages/FormPack.tsx`. Add a form = one spec in forms.ts + a test.


## Packs added (Nov 2026)
| Form | Comes from |
|---|---|
| DPT-3 | Paid-up capital from records; net worth, reserves and each category of money not treated as deposits typed per filing (total worked out); auditor's certificate asked only when deposits were accepted |
| MSME-1 | Half-year from the due date; suppliers, amount due and reasons typed per filing |
| CHG-1 | The register of charges entry created / modified on the event date (holder, amount, type, property, terms); creation vs modification worked out |
| CHG-4 | The register of charges entry satisfied on the event date (charge ID, holder, amount) |
| MGT-14 | The meeting and passed resolution(s) that created the filing (`FormCtx.fromMeeting`); section typed |
| SH-7 | Meeting; authorised capital after from Details, before typed; increase worked out |
| INC-22 | New address from Details, effective date, premises (NOC asked when not owned), police station, geo-location |

`FormCtx` now carries `charges` (register of charges) and `fromMeeting` (the meeting item whose `createdObligationIds` holds the filing). Labels follow the forms as we know them — to be checked against MCA's current instruction kits by a practising CS.
