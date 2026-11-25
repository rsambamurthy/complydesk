# Client compliance report

`services/clientReport.ts`: `buildReport` (one client, as of today in IST) — status (ATTENTION if anything is overdue; DUE_SOON if something is due within 15 days, waiting for the client, or a DSC has expired; else ON_TRACK), overdue with late-fee estimates (from `listObligations`), waiting for the client (stage CLIENT), next 60 days, filed in the last 45 days (with SRN), this FY's progress, DSCs expiring within 60 days. `renderReport` gives the email (text + inline-styled HTML).

- Recipients: the client's billing email, company email and active client users (`recipientsFor`), or addresses typed on the page (max 10).
- `client_reports` logs every send; the monthly run uses `period` = YYYY-MM with a unique index, so a client gets one monthly report.
- Monthly: firm setting `monthlyClientReport`; job 03:30 UTC (09:00 IST) daily, sends only on the 1st (`runMonthlyReports`).
- API: `GET /api/clients/:id/report` (clients.view — client users get their own company, without recipients/log), `POST /api/clients/:id/report/send` (compliance.work).
- Web: `pages/ClientReport.tsx` (`/clients/:id/report`, printable), button on the client page; toggle on Administration → Settings.
- Smoke: `scripts/smoke-report.ts`.
