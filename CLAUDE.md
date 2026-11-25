# ComplyDesk (working name) — working rules

Secretarial compliance for CS firms and in-house CS: Private Ltd + OPC (MVP). Same stack and patterns as VendorGate (rsambamurthy/VOB): React + Vite, Node/Express + TypeScript, Postgres + Drizzle, cookie sessions, permission-based roles.

## Reuse, never duplicate (standing rule)
Build once, use everywhere. Before writing a helper, component or rule, look for an existing one and extend it.

### Where the shared pieces live
- **Compliance rules are data**: built-ins in `server/src/compliance/catalogue.ts` (seeded to `rules`, tenant_id null); a workspace overrides by code (Administration → Compliance rules). Never hard-code a due date elsewhere.
- **Rule changes** only through `services/rules.ts` (shared validator `ruleInput`, Integrata's built-in rules, a firm's own versions and rules, history). Layers: catalogue.ts → Integrata (source PLATFORM; deploys don't overwrite) → workspace. UI: `components/RuleEditor.tsx` (editor, history, wording) on one `pages/admin/Rules.tsx` for both firm and platform. Documented in `docs/rules.md` and `components/RulesGuide.tsx` — keep both in step with the engine.
- **Engine** (pure, tested): `server/src/compliance/engine.ts` — `obligationsFor`, `nextKycFy`, `eventObligation`, `lateFeeEstimate`. Date helpers `compliance/dates.ts` (FY, first FY, AGM last date).
- **Sync**: `compliance/sync.ts` — `syncClient` / `syncTenant` store engine output; status/SRN/notes are never overwritten; nightly job `jobs.ts`.
- **Client master writes** only through `services/clients.ts` (routes and Excel import both use it). Every write re-syncs.
- **Obligations** read/update through `services/obligations.ts`; buckets (overdue/week/month/open/done) defined once in `bucketWhere`. Meeting → anchor linkage in `feedAnchors` (AGM held → AGM date; earliest board meeting → first BM date).
- **Field rules**: `server/src/lib/validators.ts` — screens and import share them.
- **Web**: `AppFrame`/`NavIcon`/`TabStrip`/`ExcelImport`/styles copied from VendorGate; one `RecordModal` form for every record (`components/RecordForm.tsx`); field lists in `components/ClientForms.tsx`; one `ObligationTable` / `ObligationModal` / `EventModal` (`components/Obligations.tsx`) for dashboard, calendar and client tab; labels in `lib/format.ts`; product name only in `components/Brand.tsx`.

- **Meetings**: `services/meetings.ts` (schedule, agenda, attendance, held → calendar + filings via services/obligations.ts, minutes); rules in `meetings/checks.ts`, wording in `meetings/templates.ts`; documented in `docs/meetings.md`. Web: `components/Meetings.tsx` (list, schedule) shared by the Meetings page and the client's Meetings tab; `pages/MeetingDetail.tsx`, `pages/MeetingPrint.tsx`.
- **Picking clients**: `components/ClientPicker.tsx` (type-to-search by name/CIN over `/clients/lookup`, chips) — use it wherever companies are chosen, never a full list. Client users are managed from the client's *Client users* tab (`components/ClientUsers.tsx`) or Administration → Users.
- **Platform / sign-up / trial**: `services/platform.ts` — `signUp`, `accessState` (TRIAL / ACTIVE / TRIAL_ENDED / PAYMENT_DUE / SUSPENDED / PENDING_APPROVAL), `assertClientCapacity`, platform settings (approval switch, trial days, trial client limit), console actions. Read-only enforcement in `requireWritable` (auth/session.ts). Platform admins = emails in `PLATFORM_ADMINS`. Email via `lib/mailer.ts` (SMTP_* env; logs when unset).

## Commands
`npm run dev` · `npm test` (engine) · `npx tsx server/scripts/smoke.ts` and `smoke-signup.ts`, `smoke-rules.ts`, `smoke-meetings.ts` (end-to-end, need running API + seed, PLATFORM_ADMINS=admin@demo.in) · `npm run db:seed` (demo workspace "demo", admin@demo.in / Demo@12345) · `npm run db:generate` after schema changes.
