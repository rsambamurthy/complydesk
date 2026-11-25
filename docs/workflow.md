# Filing workflow, documents and reminders

## Stages
To do → Collecting data → Drafted → With reviewer → With client → Ready to file → Filed (SRN) → Approved by MCA.
Side stages: Resubmission (MCA sent it back) and Not applicable.

- **Maker-checker** (Settings → "A reviewer checks every filing", on by default): a drafted filing goes to a reviewer (Partner / Firm Admin). Whoever drafted it can't approve it. "Return for changes" sends it back to Drafted with a note.
- **Client approval** (off by default): after review the filing waits for the client. The client's Client Admin approves from their login, or the firm records an approval received by email.
- Filing needs the SRN; MCA approval or resubmission is recorded after.
- Every move is kept in the filing's History (who, when, note).

## Documents
Drop files on any filing or meeting (PDF, images, Word, Excel, zip; up to 15 MB). Stored in the database by default; set `STORAGE=s3` with `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_ENDPOINT` for R2/MinIO) to use object storage.

## Daily reminder email (08:30 IST)
One email per person per day, only when something needs them: filings due on the firm's reminder days (default 15, 7, 1), overdue filings, filings waiting for their review or approval, DSCs expiring in 30/15/7/1 days, and minutes not yet signed. Each person can switch theirs off under Users. Administration → Settings shows today's email and can send it to you now.
