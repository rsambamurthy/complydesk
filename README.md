# ComplyDesk — secretarial compliance (MVP, Sprint 1–2)

Every client company's MCA compliance calendar, worked out from its own facts.

**Built so far:** client master (companies, directors & KMP, shareholders, auditors), Excel import, rules engine with editable rules, compliance calendar, dashboard, obligation tracking (status, held/filed date, SRN, assignee, late-fee estimate), event-based filings, users & roles (firm staff and client users), audit log.

**Next (Sprint 3–5):** meetings (agenda → notice → minutes, resolutions creating filing tasks), filing workflow with maker-checker, reminders (email/WhatsApp), document vault, statutory registers.

## Run locally
```
createdb secretarial            # Postgres 14+
cp server/.env.example server/.env
npm install
npm run db:seed                 # migrates + demo workspace
npm run dev                     # web :5173, API :4000
```
Sign in: workspace `demo`, `admin@demo.in` / `Demo@12345`.

## Deploy (Railway)
Dockerfile + railway.json; set `DATABASE_URL`. Migrations and the rules catalogue run on start; `SEED_DEMO=true` also creates the demo workspace.
