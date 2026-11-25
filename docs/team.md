# Team workload and time

- Permission `team.view` (Firm Admin and Partner; migration 0016 grants it to existing workspaces). Anyone with `compliance.work` logs their own time.
- `time_entries` (user, client, optional filing, date, minutes, note).
- `services/workload.ts`: `teamWorkload` (per staff member: open assigned, overdue, due in 7 days, stuck = DATA/DRAFTED/RESUBMIT with no event for 14 days, reviews waiting for reviewers (not their own drafts), filed/approved events in the period, hours; totals incl. unassigned), `hoursByClient` (hours, who, issued invoices' taxable value in the period, ₹/hour), time entries (add / list / remove; future dates refused).
- Routes `/api/team` (`/workload?period=month|last|fy`, `/time`). Web: `pages/Team.tsx`, `components/TimeLog.tsx` (in `FilingModal`).
- Smoke: `scripts/smoke-team.ts`.
