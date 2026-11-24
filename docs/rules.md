# How ComplyDesk works out compliance dates

The compliance calendar is generated from **rules stored as data**. Nothing about a due date is hard-coded.

## Layers
1. **As shipped** — `server/src/compliance/catalogue.ts`, loaded on every deploy.
2. **Integrata** — the platform console (Integrata platform → Built-in rules) can change any shipped rule or add new ones. These rows are marked `PLATFORM` and a deploy never overwrites them. "Back to the rule as shipped" undoes a change.
3. **A firm** — Administration → Compliance rules. A firm can change any rule for itself (its version wins for that firm only) or add its own rules. "Back to the built-in rule" undoes it.

Every change is recorded in `rule_history` (who, when, before, after) and shown on the rule's History tab. Saving recalculates the calendars straight away (a firm's change: that firm; Integrata's change: every firm, in the background) and again nightly.

## A rule
| Part | Meaning |
|---|---|
| Form / description / law | What it is (e.g. AOC-4, Financial statements, Sec 137) |
| Applies to | All conditions must hold: company type (Private / OPC), small company or not, client ticks (MSME dues, outstanding loans), first financial year only, auditor's term ends that year. Nothing ticked = all companies. |
| Kind of due date | See below. How often it recurs follows from the kind. |
| Late fee | ₹ per day (shown as an estimate when late) or a note |
| In force from / until | Due dates outside these are ignored — a change in law is a new rule from a date, the old one ending the day before |
| Use this rule | Switch off without deleting |

## Kinds of due date
- **Fixed date** — day and month, in the FY or the year after (DPT-3: 30 June after the FY).
- **Several dates** — one item per period (board meetings by quarter; MSME-1 by half-year).
- **Days after an anchor** — the AGM held, the first board meeting of the FY, or incorporation. AGM and board-meeting dates come from marking the meeting held. Until known the date is *estimated* from the last permitted AGM date or a fixed date (or not shown).
- **Last AGM date** — 6 months after the FY ends; 9 months for the first FY.
- **Each director, every N years** — DIR-3 KYC: from the FY of the last filing + N, else the FY of DIN allotment + N + 1, by the set day.
- **Days after an event** — added by hand from a client's Compliance tab (appointment, allotment, charge…).

## Years and edge cases
- The calendar covers last FY (its annual filings fall due this year) and the current FY.
- Nothing is due before incorporation. A company incorporated in January–March has a first FY ending the next 31 March.
- Items already filed or held keep their dates when rules change; untouched items the rules no longer produce are hidden; items someone worked on stay.

The engine is `server/src/compliance/engine.ts` (pure, unit-tested in `server/tests/engine.test.ts`).
