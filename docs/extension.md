# ComplyDesk Chrome extension — MCA form filler

Fills MCA V3 web forms from a filing's MCA form data (docs/eforms.md), in a side panel next to the portal.
The person checks every value, saves, signs with DSC and submits on the portal — the extension never clicks buttons, submits or signs.

## How it works
1. In ComplyDesk: **MCA form filler** (left menu) → download, install (Load unpacked) and **Create a connection code** (one per browser; shown once; disconnect any time).
2. In the panel: ComplyDesk address + code → pick the filing (open filings that have form data).
3. On the portal, open the form and enter the CIN, then **Find fields on this page**: the panel reads each field's label on the page (label tag, aria-label, or the nearest text before it — table cells included) and matches it to ComplyDesk's fields by wording (`extension/lib/match.js`; aliases in `server/src/eforms/forms.ts`). Locked fields (pre-filled by MCA) are left alone.
4. Untick or re-point any match, **Fill**: values are set the way typing would (input/change events, so the portal's own checks run); dates stay dd/mm/yyyy (converted for date inputs); Indian commas are dropped from numbers; drop-downs are matched by option text. Filled fields get a green outline, failures a red one with the reason.
5. Anything unmatched: click into the portal field, then **Put in selected field**. Tables (shareholders, directors, meetings): **Copy for Excel** into MCA's templates.

## Security
- The connection code is a bearer token (`cdx_…`, stored as sha256 in `api_tokens`), usable only on `/api/ext` (who am I, filings with form data, a filing's form data) — read-only, the user's own client scope, firm staff only. Revoked codes stop at once.
- The extension can run only on `*.mca.gov.in` and on the ComplyDesk address the user grants when connecting.

## Code and tests
`extension/` (manifest V3, `panel.*`, `content.js`, `lib/match.js`) — served zipped at `/api/extension.zip`; `server/src/routes/ext.ts`; `requireExtension` in `auth/session.ts`; web `pages/Extension.tsx`.
Tests: `server/tests/extension.test.ts` (matching), `server/scripts/smoke-ext.ts` (API), `extension-test/` (mock MCA form + panel harness with a `chrome.*` stub, for Playwright).

The portal's real labels aren't published: the matching was built on MCA's instruction-kit wording and a mock form. Check it on the live portal and add aliases in forms.ts where a field isn't matched.

Next: publish on the Chrome Web Store (so firms install with one click instead of Developer mode).
