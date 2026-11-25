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
