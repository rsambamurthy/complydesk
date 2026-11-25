# Meetings

Board meetings, AGMs and EGMs: **schedule → agenda → notice → attendance → held → outcomes → minutes signed**.

## Checks (warnings — the CS decides)
| Check | Rule |
|---|---|
| Notice | Board: 7 days (Sec 173(3)). General meeting: 21 clear days (Sec 101). Shorter notice can be recorded. |
| Quorum | Board: one-third of directors in office or 2, whichever is higher; video counts (Sec 174). Private company general meeting: 2 members in person (Sec 103). |
| Gap | Not more than 120 days between board meetings (Sec 173(1)); small companies / OPCs exempt. |
| Minutes | Signed within 30 days of the meeting (SS-1 / SS-2). |

Code: `server/src/meetings/checks.ts` (pure, tested in `tests/meetings.test.ts`).

## Agenda templates
`server/src/meetings/templates.ts` — standard items and resolutions with placeholders ({{company}}, {{person}}, {{designation}}, {{date}}, {{fy}}). Each can list:
- **filings** — event rules (DIR-12, PAS-3, CHG-1, CHG-4, INC-22, SH-7, MGT-14) put on the calendar, dated the meeting day, when the item is passed or noted;
- **completes** — an annual calendar item it takes care of (MBP-1 / DIR-8 at the first board meeting of the FY).
Filings can be changed per item. Wording is a draft for a practising CS to adapt.

## What "held" does
1. Ticks off the calendar item: the AGM of the FY, or the open board meeting for the period the meeting falls in (or the "first board meeting").
2. That date feeds the AGM / first-board-meeting anchors, so AOC-4, MGT-7, ADT-1 and MBP-1 move with it.
3. Every passed / noted item creates its filings. Changing an outcome back removes filings nobody has started; started ones stay. Signed minutes lock the outcomes.


## AI drafting

- One AI helper for the whole app: `server/src/lib/ai.ts` (`aiMode`, `callTool` — forced tool call, optional cached system block). Document reading and the help assistant use it too.
- Pure `server/src/meetings/drafting.ts` (tested in `tests/drafting.test.ts`): `MinutesFacts` (meeting record + notes), instructions and tool shapes, `verifyMinutes` (resolutions word for word, everyone present / chair named, date, quorum claim, `strangeFigures`), `cleanDraft` (resolution type allowed for the meeting, filings limited to event rules, figures not in the request, blanks), and stand-ins for `EXTRACT_DRIVER=mock`.
- `services/meetingAi.ts`: `draftMinutesAi` (saves the CS's notes on the meeting, returns text + issues + assumptions — the minutes are saved only by the CS), `draftItemAi`, `draftExplanatoryAi`; per-workspace daily limit `AI_DRAFT_DAILY_LIMIT` (default 100); every request logged in `ai_drafts`.
- Items carry `notes` (what was discussed) and `explanatory` (Sec 102, printed with a general meeting's notice). Meetings carry `notes`.
- Routes: `GET /api/meetings/ai/status`, `POST /api/meetings/:id/minutes-ai`, `POST /api/meetings/:id/items/draft`, `POST /api/meetings/items/:itemId/explanatory-ai`.
- Certified true copy of a passed resolution: `/meetings/:id/print/ctc?item=…`.
- Smoke: `scripts/smoke-drafting.ts`.
