# Statutory registers

Client → **Registers** tab. Six registers, as data in `server/src/registers/specs.ts`:

| Register | Law / form | Kept as |
|---|---|---|
| Register of members | Sec 88(1)(a), MGT-1 | Built from the Shareholders tab (particulars: folio, address, father's/spouse's name, occupation, nationality, became member / ceased) + the share register |
| Allotments and transfers of shares | MGT-1 share details; Sec 39, 56 | Entries. Allotment → **PAS-3** on the calendar |
| Register of directors and KMP and their shareholding | Sec 170(1), Rule 17 | Built from the Directors & KMP tab (father's/spouse's name, address, date of birth, nationality, occupation, ICSI no. for a CS); shares matched by PAN, else name |
| Register of charges | Sec 85, CHG-7 | Entries. Creation / modification → **CHG-1**; satisfaction → **CHG-4** (closes the charge) |
| Register of contracts in which directors are interested | Sec 189, MBP-4 | Entries, Part A (Sec 184(2)) / Part B (Sec 188) |
| Register of loans, guarantees, security and acquisitions | Sec 186(9), MBP-2 | Entries. Special resolution date → **MGT-14** |

- Pure `registers/build.ts` (tested): checks entries against the fields, builds every register's columns and rows (dd/mm/yyyy, ₹ in Indian grouping) — the same view feeds the screen, print and Excel.
- Members register warns when a member's allotments and transfers don't add up to the holding on the Shareholders tab; both registers list missing particulars ("To check before printing").
- A member or director named in a register entry can't be deleted — enter the date they ceased.
- `services/registers.ts`: entries go in `register_entries` (data jsonb, entry date, closed on); event filings via `services/obligations.addEvent` (duplicates ignored). Excel: `GET /api/registers/:clientId/export.xlsx[?code=]`. Print: `/clients/:id/registers/:code/print` (A4 landscape).
- Add a register = a spec in specs.ts (fields, date key, events) + a test; derived registers need a builder in build.ts.
- Column wording follows the prescribed forms — to be confirmed by a practising CS before a firm relies on a print as the register.
