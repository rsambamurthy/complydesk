# Regulatory updates

- Tables `reg_updates` (platform-wide; `applies` like a rule's: types / small / flags / all; `forms` = rule codes; impact; DRAFT → PUBLISHED) and `reg_reviews` (one per firm and update).
- Pure `server/src/regulatory/match.ts` (`affects`, `describeApplies`, tested) and `regulatory/draft.ts` (AI instructions, tool, stand-in).
- `services/regulatory.ts`: `draftFromDocument` (text or PDF → `callTool`; mock without a key), save / publish (emails Firm Admins of firms with affected clients), `firmUpdates` (with affected clients, scope-aware), reviews.
- Routes: `/api/regulatory` (firm: list, count, review), `/api/platform/reg-updates` (Integrata: draft, CRUD, publish).
- Web: `pages/Regulatory.tsx` (+ `RegBanner` on the dashboard), `pages/PlatformRegUpdates.tsx`.
- No automatic fetching from the MCA site: Integrata publishes after checking the source. Smoke: `scripts/smoke-regulatory.ts`.
