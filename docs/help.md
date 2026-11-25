# Help and the help assistant

One source: `help/manual.md` (the user manual; screenshots in `web/public/help/`). Edit it there — the Help pages and the assistant both read it. Section ids are slugs of the headings without numbers, so renaming a heading changes its link (update `PAGES` in `server/src/help/manual.ts`; the test checks every page maps to a real section).

## What users see
- **?** in the top bar on every page opens the *Ask ComplyDesk* drawer: suggested questions for that page, a link to that page's manual section, and the assistant.
- **Help** in the menu (`/help`, `/help/:section`): contents, search, each section with its screenshots, and the assistant.
- Every answer links to the manual sections it used, with 👍 / 👎.

## How answers are made
- `server/src/help/manual.ts` (pure, tested): `parseManual`, `searchManual`, `matchFaq`, `sectionForPage`, `suggestionsFor`.
- `server/src/help/assistant.ts`: with an AI key (same switch as reading documents — `ANTHROPIC_API_KEY`, not `EXTRACT_DRIVER=mock`) Claude answers **only from the manual** (whole manual in a cached system prompt, forced `answer` tool returning answer / sections / covered). Model: `HELP_MODEL`, else `EXTRACT_MODEL`. It is told to say when the manual doesn't cover a question and to point legal questions back to the Act and rules.
- Without AI: the best FAQ row, else the opening of the best-matching section.
- It sees only the manual, the page path and the user's role — never client records.

## Limits and the log
- `HELP_DAILY_LIMIT` questions per user per day (default 60). Help pages and search have no limit, and work in a read-only workspace.
- Every question is stored in `help_questions` (page, answer, sections, covered, helpful). Integrata: `GET /api/platform/help-questions?gaps=1` lists questions the manual didn't cover or users marked unhelpful — the list of what to add to the manual.
