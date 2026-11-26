# AOC-4 XBRL instance document

ComplyDesk writes the XBRL instance document for AOC-4 XBRL filings of companies following Accounting Standards
(MCA's **C&I taxonomy 2016**, Schedule III Division I). Ind AS companies (Ind AS taxonomy 2017) are not covered yet.

## Where the data comes from
| Part of the document | Source |
|---|---|
| [400100] General information | Client record (name, CIN, registered office, incorporation date), client profile (PAN, `xbrl.industry`, `xbrl.category`, `xbrl.booksElectronic`), filing (`xbrl.employees`, `xbrl.boardMeetingDate`, `xbrl.rounding`, `xbrl.cashFlow`) |
| [100100] Balance sheet, [100200] P&L | Financial statements read onto the filing (`fs.<line>.cy/py`); sub-totals and the profit chain computed; revenue / depreciation splits, CSR and EPS from `xbrl.*` |
| [200100] Share capital (one class of equity shares) | Register of members at year end (shares, face value), authorised capital; `xbrl.sharesPy`, `xbrl.sharesPyOpening` for the reconciliation |
| [400300] Signatories | Directors in office (or `xbrl.signingDins`), CS and CFO from Directors & KMP; dates = `xbrl.signingDate` or the board meeting |
| [400200] Auditor | Current auditor (firm, FRN) + `xbrl.auditor*`; ADT-1 SRN = `xbrl.adt1Srn` or the last ADT-1 filed |

## How it's built (`server/src/xbrl/`)
- `ci2016.generated.ts` — element names, types, period types, balances, typed domains, axis defaults, enumerations / patterns and calculation arcs, generated from MCA's package by `scripts/xbrl-taxonomy.py` (the package the MCA validator downloads, `Taxonomy-2016-03-31`). The package itself is not in the repo.
- `instance.ts` — pure. `checkFact` refuses elements not in the taxonomy, abstract ones, wrong types, values outside enumerations or patterns (CIN, PAN, DIN, SRN), wrong axes / members, and default members (never written). `checkCalculations` applies the calculation linkbase and MCA generic business rule 1 (a non-zero parent needs a part; parts need their parent). `writeInstance` writes contexts (CIN scheme, dimensions in the scenario, no unused or duplicate contexts), units (INR, shares, pure, INR per share) and facts (`decimals`, never `precision`); schemaRef `https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd`.
- `aoc4.ts` — pure. ComplyDesk data → facts; MCA business rules (mandatory BS / P&L elements reported as 0 when nil, non-negative elements, equity and liabilities = assets, EPS, share capital note when share capital > 0, paid-up × par = share capital, auditor and signatory fields); `COVERAGE` (what's included, partly, not yet).
- `services/xbrl.ts` — gathers the data; `GET /api/obligations/:id/xbrl` (issues, coverage, fact count) and `GET /api/obligations/:id/xbrl.xml` (download, audited).

## Checking
- Unit tests `server/tests/xbrl.test.ts`; smoke `server/scripts/smoke-xbrl.ts` (writes the XML to `/tmp/smoke-aoc4-xbrl.xml`).
- Dev: `python3 -I server/scripts/xbrl-schema-check.py <taxonomy dir> <instance.xml>` validates against the official schemas (offline) and checks dimensional validity against the definition linkbases, unused / duplicate contexts and units. Needs `pip install xmlschema`.
- Not done here: MCA's XBRL validation tool (business rules in full, the PDF). Run it before filing.

## Not covered yet (listed on the page)
Cash flow statement; notes on reserves, borrowings, investments, sub-classification of assets and liabilities, tangible / intangible assets, related parties, income and expenses; KMP remuneration; directors' report; CARO remarks; preference shares and shareholders over 5%. Each is a new section in `aoc4.ts` with its data source.

## Updating the taxonomy
Download MCA's package, unzip, run `python3 -I server/scripts/xbrl-taxonomy.py <dir> server/src/xbrl/ci2016.generated.ts`, run the tests.
