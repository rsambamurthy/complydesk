# Reading documents into forms

Upload a document → Claude reads it → a person checks the pre-filled form (unclear values highlighted) → Save.
Nothing is written until Save, and saving goes through the same services and field rules as typing.

| Document | Where | Fills in |
|---|---|---|
| Board / general meeting papers (minutes, resolutions, circular resolutions) | client → Compliance → *Find filings in board papers* (or *Read a document*) | Event filings with due dates (DIR-12, PAS-3, CHG-1, CHG-4, MGT-14, SH-7, INC-22, DIR-3 KYC change — the firm's own event rules), adds newly appointed directors / KMP, marks resigned ones ceased; lists decisions needing no filing and why. Already-on-calendar events are shown unticked. |
| MCA company master data | Clients → *Add from MCA master data*; client → *Read a document* | Company details, directors / KMP (new ones only; existing DINs skipped) |
| Certificate of Incorporation / MOA | same | CIN, date, RoC, authorised capital |
| Last annual return (MGT-7 / 7A) | client → *Read a document* | Register of members (replace or add), new directors, auditor, AGM date for the FY |
| Audited financial statements | client → *Read a document* | Paid-up capital, small company (≤ ₹10 cr paid-up and ≤ ₹100 cr turnover, G.S.R. 880(E), 1 Dec 2025), MSME-1 / DPT-3 flags |
| Auditor consent / ADT-1 | client → *Read a document* | New current auditor (5-year term assumed if not stated, flagged) |
| MCA challan / SRN | filing → *Uploaded on MCA* → *Read the SRN and date* | SRN and filed date (warns if the form or CIN doesn't match) |
| DSC certificate (.cer) | client → Directors → *Read DSC files* | DSC expiry, matched to directors by name — read directly, no AI |

The read document is kept on the client (Documents tab) or the filing. Files read but never used are deleted after 3 days.

## Setup (Railway variables)
- `ANTHROPIC_API_KEY` — switches the feature on (buttons are hidden without it).
- `EXTRACT_MODEL` — optional, default `claude-sonnet-5-5`.
- `EXTRACT_DAILY_LIMIT` — documents per workspace per day, default 200.
- `EXTRACT_DRIVER=mock` — fixtures instead of the API (tests, demos).

## Code
`server/src/extract/doctypes.ts` (what to read, as data) · `extract/reader.ts` (Claude call with a forced tool, DSC parser) · `extract/normalise.ts` (pure: values → app shapes + what to check; tested) · `services/extract.ts` (read, apply, attach, purge) · `routes/extract.ts` · web `components/DocumentReader.tsx`. Adding a document = an entry in doctypes.ts, a case in normalise/apply, a review panel.

## Board papers — how filings are found
The model is given the workspace's active event rules (code, form, event) and may only propose those. Guidance it follows: the event date is the effective date (appointment, resignation, allotment, charge creation, office shift), else the meeting date (flagged); approval to borrow is not a charge; private companies don't file s.179(3) board resolutions in MGT-14. Matching to people (by DIN, then exact name) and to the calendar (same filing, date and person) is pure code in `proposeEvents` (normalise.ts) and tested.
