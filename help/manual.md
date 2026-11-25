# ComplyDesk — User Manual

## 1. About ComplyDesk

ComplyDesk keeps every client company's Companies Act / MCA compliance on one calendar and moves each filing from "to do" to "approved by MCA" with a reviewer's check on the way. It is built for company secretary firms and in-house CS teams looking after private limited companies and OPCs.

What it does for a firm:

- Works out every filing and meeting each client owes (AOC-4, MGT-7/7A, DIR-3 KYC, DPT-3, MSME-1, board meetings, AGM…) with due dates and late-fee estimates.

- Runs each filing through a fixed path: prepare → review → client approval (optional) → file → MCA approval.

- Reads company documents with AI (MCA master data, MGT-7, financials, challans, board minutes) so data is checked, not typed.

- Checks a filing against the records before approval, and prepares the MCA form data — with a Chrome extension that fills the MCA portal.

- Sends each person one reminder email a day.

### Who can do what

| Role                     | Who                             | Can                                                                                                              |
|--------------------------|---------------------------------|------------------------------------------------------------------------------------------------------------------|
| Firm Admin               | The firm's owner / lead CS      | Everything in the workspace: settings, users, rules, clients, filings, approvals                                 |
| Partner / Reviewer       | Senior CS who signs off         | Work on clients and filings; approve filings prepared by others; approve over the pre-filing check with a reason; billing |
| CS Executive             | Team member                     | Keep client records; prepare filings; read documents; use the MCA form filler                                    |
| Client Admin             | The client company's own person | See their company's calendar; approve filings for filing                                                         |
| Client Viewer            | The client company's own person | See their company's calendar (read-only)                                                                         |
| Integrata platform admin | Integrata                       | Approve firm sign-ups, manage trials, maintain the built-in compliance rules                                     |

A client user sees only the companies they are linked to. Whoever drafted a filing cannot approve it.

## 2. Process flow

A firm is set up once; clients' calendars then build themselves, events through the year add filings, and every filing follows one path to MCA approval.

![ComplyDesk end to end · 4 stages](/help/image1.png)

ComplyDesk end to end · 4 stages

Rows 1–2 are done once per firm and per client; rows 3–4 repeat all year.

### Each filing's stages

![Filing stages · 8 stages, 3 ways back](/help/image2.png)

Filing stages · 8 stages, 3 ways back

The reviewer can't be the person who drafted the filing; client approval is a firm setting.

### A meeting

Schedule → agenda → notice → attendance → held (calendar ticked off, AGM date recorded) → outcomes (passed items add their filings) → minutes signed. Details in section 7.

## 3. Getting started

A firm signs up, verifies its email and starts a free trial straight away (or waits for Integrata's approval, if that switch is on).

### Sign up and sign in

1.  Open ComplyDesk and choose **Sign up**. Enter the firm name, a short workspace code (e.g. raoassociates), city, ICSI membership number, your name, email, mobile and a password.

2.  Open the verification email and click the link. If it doesn't arrive, use **Resend link** on the banner.

3.  Sign in with the **workspace code**, your email and password.

4.  The trial bar at the top shows the days left and the client limit. To subscribe, write to info@integratatech.ai.

![Sign-up page: create your firm's workspace](/help/image3.png)

*Sign up: the firm's workspace, the first admin, and the free trial.*

When a trial ends or a payment is due, the workspace becomes read-only: everything can be seen, nothing can be changed.

### Getting help

Click **?** at the top right of any page to ask ComplyDesk a question. The assistant answers from this manual, knows which page you are on, and links to the sections it used; press 👍 or 👎 so Integrata can improve the answers. **Help** in the menu opens this manual inside ComplyDesk, with a search box.

### Add your team

1.  **Administration → Users → Add user**: name, email, role (Firm Admin, Partner / Reviewer, CS Executive).

2.  For a client's own people, choose Client Admin or Client Viewer and pick their companies (type to search by name or CIN) — or add them from the client's **Client users** tab.

3.  Each user can switch their own daily reminder email off.

![Administration → Users](/help/image4.png)

*Administration → Users: the team, their roles and when they last signed in.*

### Firm settings (Administration → Settings)

| Setting                                                            | Default  | What it does                                                       |
|--------------------------------------------------------------------|----------|--------------------------------------------------------------------|
| A reviewer checks every filing before it is filed                  | On       | Maker-checker: a Partner / Firm Admin approves; the preparer can't |
| The client approves every filing before it is filed                | Off      | Adds a "With client" step for the client's admin                   |
| No approval or filing while the pre-filing check has things to fix | On       | Red items hold back approval; partners can override with a reason  |
| Remind this many days before the due date                          | 15, 7, 1 | Days the daily email mentions an item                              |
| Include overdue items every day                                    | On       | Overdue items stay in the email until done                         |
| Also email client users about their own company                    | Off      | Client users get their own digest                                  |

The same page shows today's reminder email and can send it to you now.

![Administration → Settings](/help/image5.png)

*Settings: filing workflow switches and the daily reminder email.*

## 4. Clients

Each client company's record drives its compliance calendar: change a record and the calendar is worked out again at once.

### Adding clients — three ways

| Way                  | Where                                  | Best for                                                                                             |
|----------------------|----------------------------------------|------------------------------------------------------------------------------------------------------|
| Add client           | Clients → **Add client**               | One company, typed in                                                                                |
| From MCA master data | Clients → **Add from MCA master data** | Upload the master data page (PDF / screenshot); company and directors are filled in for you to check |
| Excel import         | Clients → **Import from Excel**        | Many companies at once — download the template, fill it, upload                                      |

The CIN must match the company type (PTC for private, OPC for one person companies). A CIN can be added only once.

### The client page

- **Compliance** — the client's filings and meetings (To do / Done / Everything), AGM date per year, **Add event-based filing**, **Find filings in board papers**.

- **Meetings** — board meetings, AGM and EGM of this client.

- **Directors & KMP** — name, designation, DIN / PAN, appointment and cessation dates, DSC expiry, last DIR-3 KYC year. **Read DSC files** fills DSC expiry from certificate files.

- **Shareholders** — the register of members; holdings and paid-up value add up automatically.

- **Auditor** — firm, FRN, appointment date, term (first and last FY). ADT-1 follows the term.

- **Details** — registered office, RoC, email, capital, and the applicability ticks (owes MSME suppliers \> 45 days → MSME-1; outstanding loans / money received → DPT-3).

- **Registers** — the statutory registers (section 4, Statutory registers).

- **Documents** — company records; documents read by AI are kept here.

- **Client users** — the company's own people who can log in.

![Client page — Compliance tab](/help/image6.png)

*A client's page: tiles, tabs and the Compliance tab with the year's filings.*

![Client page — Directors & KMP tab](/help/image7.png)

*Directors & KMP: DIN, appointment, DSC expiry and last KYC year; Read DSC files fills expiry dates.*

**Edit details** changes the company record. **Read a document** updates the record from a document (section 8).

Tip: record the AGM date as soon as it is held (or mark the AGM held in Meetings). AOC-4 and MGT-7 due dates are estimates until then.

### Client compliance report

**Compliance report** at the top of a client's page opens a one-page report for the company: its status (on track / due soon / needs attention), what is overdue with late-fee estimates, what is waiting for the client's approval, what is due in the next 60 days, what was filed recently with SRNs, and DSCs to renew.

- **Print / save as PDF** for a meeting or a file.
- **Email this report to the client** sends it now — to the client's accounts email (Billing details), company email and client users, or to addresses you type.
- To send it to every client automatically on the 1st of each month, switch on **Administration → Settings → Client compliance report**.

Client users can open the same report for their own company.

### Statutory registers

The client's **Registers** tab keeps the registers the Act requires: members (MGT-1), allotments and transfers of shares, directors and KMP with their shareholding, charges (CHG-7), contracts in which directors are interested (MBP-4) and loans, guarantees, security and investments (MBP-2).

- Members and directors & KMP are built from the **Shareholders** and **Directors & KMP** tabs — fill in the particulars there (address, father's / spouse's name, date of birth…).
- The others take entries: open the register and press **Add entry**. Recording a charge adds CHG-1 to the calendar, its satisfaction adds CHG-4, an allotment adds PAS-3 and a special resolution for a loan or investment adds MGT-14.
- **To check before printing** lists missing particulars and holdings that the allotments and transfers don't add up to.
- **Print** opens the register on A4 landscape for printing or saving as PDF; **Excel** downloads it.
- A member or director named in a register can't be deleted — enter the date they ceased instead.

## 5. Dashboard and compliance calendar

The dashboard shows where every client stands today; the calendar lists every filing and meeting across clients.

**Dashboard:** tiles for Overdue, Due in 7 days, Due in 30 days, Open in all, Done (this and last FY); a banner for filings waiting for your review or approval; the overdue and next-7-days lists; clients needing attention.

![Dashboard](/help/image8.png)

*Dashboard: today's numbers, what's waiting for you, overdue and due-soon lists.*

**Compliance calendar:** filter by bucket (Overdue, This week, This month, Open, Waiting for review, With client, Done), client, form and year. Each row shows:

- **Due** — the date and how far away it is (red when late, amber within a week). "est." means the date depends on a date not yet recorded (usually the AGM).

- **Filing / meeting**, **Period**, **Status** (the stage), **With** (assignee) and **Late fee** (estimated additional fee so far, or "Fee applies").

![Compliance calendar](/help/image9.png)

*Compliance calendar: every client's filings and meetings, with stage, assignee and late fee.*

Click a row to work on it (section 6).

### Event-based filings

Filings triggered by an event (DIR-12, PAS-3, MGT-14, SH-7, CHG-1, CHG-4, INC-22, DIR-3 KYC change) are added when the event happens, due 30 days after it:

- **By hand** — client → Compliance → **Add event-based filing**: pick the filing, the event date, a description and (for DIR-12) the person.

- **From a meeting** — an agenda item marked passed adds its filing (section 7).

- **From board papers** — **Find filings in board papers** reads minutes and proposes them (section 8).

Recurring filings (AOC-4, MGT-7/7A, DPT-3, MSME-1, DIR-3 KYC, ADT-1, board meetings, AGM) appear on their own, from the rules and the client's records.

## 6. Working a filing

Every filing moves through the same stages; the buttons on the filing show only the steps you may take now, and every step is kept in its History (diagram in section 2).

| Stage                        | Who moves it on                                       | Button                                       |
|------------------------------|-------------------------------------------------------|----------------------------------------------|
| To do                        | CS Executive                                          | Start collecting data / Form drafted         |
| Collecting data              | CS Executive                                          | Form drafted                                 |
| Drafted                      | CS Executive                                          | Send for review                              |
| With reviewer                | Partner / Firm Admin (not the preparer)               | Approve (reviewed) / Return for changes      |
| With client (if switched on) | Client Admin, or the firm recording an email approval | Approve for filing / Send back with comments |
| Ready to file                | CS Executive                                          | Uploaded on MCA (enter SRN)                  |
| Filed                        | CS Executive                                          | Approved by MCA / MCA asked for resubmission |
| Approved by MCA              | —                                                     | Done                                         |

**Not applicable** (with a reason) closes a filing that doesn't apply; **Reopen** brings it back.

### Steps for the preparer

1.  Open the filing from the calendar or the client. Set **Assigned to** and notes if needed.

2.  **Start collecting data**, then prepare the form. **Open … form data** shows every field of the MCA form filled from the records (section 9).

3.  Attach documents (resolutions, financials, the draft form) under **Documents**.

4.  Look at the **Pre-filing check** and fix what's red. Attach the filled-in draft and press **Check the draft against records**.

5.  **Form drafted → Send for review** (add a note for the reviewer if useful).

6.  After approval: file on the MCA portal, then **Uploaded on MCA** with the SRN (9 letters and digits, e.g. AB1234567) and the date — or **Read the SRN and date from it** using the challan.

7.  When MCA approves: **Approved by MCA**. If MCA asks for changes: **MCA asked for resubmission** (with the reason) and the filing goes back to drafting.

### Pre-filing check

The check sits on every filing (open from Drafted to Ready to file):

- **Against the records** (always): a director who can sign (DIN, KYC up to date, DSC valid), late filing, documents attached, AGM date, auditor and FRN, MGT-7 vs MGT-7A, board meetings held (4, or 2 for small companies / OPCs), shares × face value = paid-up capital, DIR-12 dates and minimum directors, ADT-1 term, DPT-3 / MSME-1 ticks, and empty MCA form fields.

- **Draft form against the records** (on request): AI reads the attached draft; ComplyDesk compares CIN, name, year, AGM date, capital, shares, directors, auditor FRN, event dates and DIN.

Red = to fix; amber = to look at; green = matched. While anything is red, **Approve** and **Uploaded on MCA** stay closed. A Partner or Firm Admin can still approve by writing why — it's kept in the History, and holds until the filing is sent back. CS Executives can't override.

![A filing with the reviewer](/help/image10.png)

*A filing with the reviewer: the stages, the MCA form data link, and the pre-filing check with 2 things to fix.*

### Client approval

With client approval switched on, a reviewed filing waits for the client. The client's Client Admin approves (or sends back with comments) from their own login; or the firm presses **Record client's approval** and notes how it was given (e.g. "by email on 24 Nov").

## 7. Meetings

A meeting goes schedule → agenda → notice → attendance → held → outcomes → minutes signed; marking it held ticks off the calendar and puts its filings on it (diagram in section 2).

1.  **Schedule** — Meetings (or the client's Meetings tab) → **Schedule a meeting**: board meeting, AGM or EGM; date, time, mode (in person / video / hybrid), venue or link. Standard items are added for you (the first board meeting of the year also gets MBP-1 / DIR-8 disclosures).

2.  **Agenda** — add items from about 20 templates (appointment of an additional director, allotment of shares, borrowing and charge, change of registered office…) or your own wording. Items about a person need the person picked.

3.  **Notice** — record when the notice went out; tick shorter-notice consent if that applies. **Print** gives the notice.

4.  **Attendance** — present, by video, leave of absence or absent for each director; members present for a general meeting.

5.  **Held** — mark it held on the date. The AGM / board meeting on the calendar is ticked off, and the AGM date feeds AOC-4, MGT-7 and ADT-1 due dates.

6.  **Outcomes** — mark each item passed, noted, deferred or not passed. A passed item adds its filings (DIR-12, PAS-3, CHG-1, MGT-14, SH-7, INC-22…) dated the meeting day. Changing an outcome back removes filings nobody has started.

7.  **Minutes** — drafted from attendance and outcomes; edit, print, then **Sign minutes** (this locks the outcomes).

![A board meeting](/help/image11.png)

*A scheduled board meeting: status steps, the notice warning, agenda items and attendance.*

The checks are warnings — the CS decides:

| Check                      | Rule                                                                                                                                        |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| Notice                     | Board: 7 days (s.173(3)). General meeting: 21 clear days (s.101); shorter notice can be recorded                                            |
| Quorum                     | Board: one-third of directors or 2, whichever is higher; video counts (s.174). Private company general meeting: 2 members in person (s.103) |
| Gap between board meetings | Not more than 120 days (s.173(1)); small companies and OPCs exempt                                                                          |
| Minutes                    | Signed within 30 days of the meeting (SS-1 / SS-2)                                                                                          |

Template wording is a starting draft for the CS to adapt.

### Drafting with AI

When the AI is switched on for your workspace:

- **Add an item → ✦ Describe it — AI drafts it**: write a sentence with the names, numbers and dates you have ("allot 5,000 equity shares of ₹10 at ₹100 each to Anita Rao on private placement"). The AI drafts the title, the resolution, the kind (board / ordinary / special), the filings it will create and — for a general meeting — the explanatory statement. Anything missing is left as ___ and listed; figures you didn't give are flagged. You check and edit before **Add to agenda**.
- **Explanatory statement**: on a general meeting item without one, **draft it with AI**; it opens in the item for you to edit. It prints with the notice under Section 102.
- **Minutes → ✦ Write with AI**: put your rough notes in **Your notes from the meeting** (and per item under **Edit → What was discussed**), then press the button. The AI writes the minutes in the Secretarial Standards style from the meeting record and your notes. ComplyDesk then checks the draft: every passed resolution word for word, everyone present and the Chairperson named, the date, the quorum, and no figures that aren't in the record or your notes. Put right anything marked ✗, then **Save**.
- **Certified true copy**: each passed resolution has a **Certified true copy** link that prints it, ready to sign once the minutes are signed.

Nothing the AI writes is saved until you save it. Without the AI, **Draft from the agenda** still writes the minutes from the agenda wording.

## 8. Reading documents with AI

Upload a PDF or a photo / screenshot; ComplyDesk reads it, shows the values in a form with anything unclear highlighted in amber, and saves nothing until you press Save.

| Document                            | Where                                                                | What it fills in                                                                                     |
|-------------------------------------|----------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| MCA company master data             | Clients → **Add from MCA master data**; client → **Read a document** | New client (or changes to one) with directors / KMP                                                  |
| Certificate of Incorporation / MOA  | same                                                                 | CIN, date, RoC, authorised capital                                                                   |
| Last annual return (MGT-7 / MGT-7A) | client → **Read a document**                                         | Register of members (replace or add), new directors, auditor, AGM date                               |
| Audited financial statements        | client → **Read a document**                                         | Paid-up capital, small company (≤ ₹10 crore paid-up and ≤ ₹100 crore turnover), MSME-1 / DPT-3 ticks |
| Auditor consent letter / ADT-1      | client → **Read a document**                                         | New current auditor (old one kept as former)                                                         |
| MCA challan / SRN acknowledgment    | filing → **Uploaded on MCA** → **Read the SRN and date from it**     | SRN and filed date; kept on the filing                                                               |
| Board / general meeting papers      | client → Compliance → **Find filings in board papers**               | Event filings with due dates; adds new directors, marks resigned ones ceased                         |
| DSC certificate files (.cer)        | client → Directors → **Read DSC files**                              | DSC expiry, matched to directors — read directly, no AI                                              |

![New client from MCA master data](/help/image12.png)

*A new client read from the MCA master data: company details and directors to check; amber = check this value.*

![Find filings in board papers](/help/image13.png)

*Board minutes read: five filings with due dates, director changes, and decisions that need no filing.*

Good to know:

- Existing directors (same DIN) are shown but not ticked, so nothing is added twice.

- A document for another company (different CIN) or for another form is called out before you save.

- With board papers you see the words of the minutes behind each filing, the decisions that need no filing (e.g. a board approval to borrow) and anything already on the calendar.

- The document is kept in the client's Documents (or on the filing). Documents read but never saved are deleted after 3 days.

- Each read counts towards the firm's daily limit (200 a day). Reading is switched on only when Integrata has set up the AI key.

## 9. MCA form data and the form filler

For MGT-7, MGT-7A, AOC-4, DIR-12, ADT-1 and PAS-3, ComplyDesk lays out every field of the MCA V3 form in order, filled from the records, and a Chrome extension can type them into the portal for you.

### MCA form data

1.  Open the filing → **Open … form data**.

2.  Each field shows its value and where it came from: **From records** (fix it in the client record if missing), **Client profile** (typed once — PAN, phone, activity codes — reused every year) or **This filing** (turnover, net worth, reason for cessation, shares allotted…).

3.  Type the missing values and **Save values**. The bar shows how many fields are ready; empty ones also show in the pre-filing check.

4.  Tables (shareholders, directors at year end, changes, meetings and attendance) have **Copy** — paste into MCA's Excel templates.

5.  The **Attachments to upload** list shows what MCA needs for this case (e.g. MGT-8 for larger companies, CSR report, DIR-12 documents by purpose).

6.  **Download Excel** or **Print** for the team or the client.

![MCA form data for MGT-7](/help/image14.png)

*MCA form data for an MGT-7: every field in order, its source, and a Copy button.*

### MCA form filler (Chrome extension)

Install once per computer:

1.  **MCA form filler** (left menu) → **Download the extension**, unzip it.

2.  Chrome → chrome://extensions → switch on **Developer mode** → **Load unpacked** → pick the complydesk-extension folder. Pin the ComplyDesk icon.

3.  Back in ComplyDesk → **Create a connection code** (shown once). Click the ComplyDesk icon in Chrome, paste the ComplyDesk address and the code, **Connect**.

![MCA form filler page](/help/image15.png)

*MCA form filler page: download, install steps and connection codes.*

Fill a form:

1.  On the MCA portal, log in, open the form and enter the CIN.

2.  Click the ComplyDesk icon; pick the filing in the panel.

3.  **Find fields on this page** — the panel matches the portal's fields to ComplyDesk's by their labels. Untick or re-point any wrong match.

4.  **Fill** — filled fields get a green outline; any that couldn't be filled get a red one with the reason. Fields the portal fills itself are left alone.

5.  Anything not matched: click into the portal field, then **Put in selected field**. Tables: **Copy for Excel**.

6.  Check every value, then save, sign with DSC and submit on the portal as usual. The extension never clicks, submits or signs.

![The form filler panel next to an MCA form](/help/image16.png)

*The ComplyDesk panel (right) after Fill: filled fields outlined in green. The form on the left is a stand-in for the MCA portal page.*

A connection code can only read form data of the clients you can see. Disconnect a browser on the MCA form filler page when you no longer use it.

## 10. Billing

**Billing** in the menu (Firm Admins and Partners) turns filed work into GST invoices and tracks what clients owe.

### Set up once

1. **Billing → Firm details**: name on invoices, address, state, GSTIN (leave empty if not registered — then no GST is charged), PAN, SAC code and GST rate (confirm with your tax adviser), invoice prefix, payment days, bank details and terms. **Bill work filed from** keeps older filings off the list.
2. **Billing → Fees**: your fee for each kind of filing. A client with a different fee gets its own on the client's **Billing** tab, where you also enter its GSTIN, billing address and any retainer.

### Raise an invoice

1. **To be billed** lists every filing marked filed (or approved by MCA) that is not on an invoice yet, by client, at its fee.
2. Tick the filings and press **Create invoice** — a draft opens. Add items, or **Add government fee** for MCA fees paid on the client's behalf (no GST on those).
3. **Issue invoice** gives it the next number (e.g. RAO/26-27/004) and locks it. CGST + SGST apply when the client is in your state, IGST otherwise — the place of supply comes from the client's GSTIN, the state you entered, or the CIN.
4. **Print / PDF** gives the tax invoice with amount in words and your bank details.

### Payments

**Record payment** on the invoice: amount received and any TDS the client deducted (both settle the invoice). The Billing page shows what is outstanding, overdue and its age, and what was collected this year.

An issued invoice can't be edited. **Cancel invoice** (with a reason) keeps the number used and puts its filings back on the to-be-billed list; if it was already in your GST return, issue a credit note through your accountant.

## 11. Reminders and daily emails

Each person gets at most one email a day, at 08:30 IST, and only when something needs them.

| In the email              | When                                                                                                                                 |
|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| Filings due soon          | On the firm's reminder days before the due date (default 15, 7 and 1) — for the person handling the client or assigned to the filing |
| Overdue filings           | Every day until done (if switched on)                                                                                                |
| Waiting for your review   | Filings sent for review (Partners / Firm Admins)                                                                                     |
| Waiting for your approval | Filings with the client (Client Admins)                                                                                              |
| DSC expiring              | 30, 15, 7 and 1 days before a director's DSC expires                                                                                 |
| Minutes to sign           | Meetings held whose minutes aren't signed, up to the 30-day limit                                                                    |

Each item links straight to the client or filing. Anyone can turn their own email off (Administration → Users, "Daily reminder email"); a Firm Admin changes the days in Settings and can preview today's email there or send it to themselves now.

Calendars are also re-worked every night, so a new financial year, director KYC cycles and estimated dates move on their own.

## 12. Administration

Firm Admins run the workspace from the Administration menu; Integrata runs the platform from its own console.

| Page             | What you do there                                                                                                                                                                           |
|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Settings         | Filing workflow switches, reminder days, preview / send today's email (section 3)                                                                                                           |
| Compliance rules | See every rule (form, law, due date, who it applies to, late fee); make the firm's own version of a built-in rule or add a rule; each change keeps a history; **Built-in** puts a rule back |
| Users            | Add users, roles, client access for client users, switch off daily email, disable accounts                                                                                                  |
| Audit log        | Who changed what and when: client records, filings, moves, documents, settings                                                                                                              |
| MCA form filler  | Download the extension; create or disconnect connection codes (every staff user, for themselves)                                                                                            |

![Administration → Compliance rules](/help/image17.png)

*Compliance rules: each form, who it applies to, its due date and late fee.*

Changing a rule re-works every client's calendar at once. The rules guide on that page explains each due-date kind (fixed date, after AGM / first board meeting, per period, after an event, KYC cycle, AGM last date).

### Integrata platform console (Integrata only)

- **Firms & sign-up** — every firm with status (pending approval, trial, active, trial ended, payment due, suspended), clients and users; approve, extend a trial, mark paid, suspend; the switch that makes new sign-ups wait for approval; trial length and trial client limit; a test email.

- **Built-in rules** — Integrata's version of each compliance rule, used by every firm that hasn't made its own. Software updates never overwrite Integrata's edits.

## 13. FAQ and troubleshooting

| Question                                  | Answer                                                                                                                                                                                                                                 |
|-------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A due date shows "est."                   | It depends on a date not recorded yet — usually the AGM. Record it (client → Compliance → FY button) or mark the AGM held in Meetings.                                                                                                 |
| A filing I expected isn't on the calendar | Check the client's Details: company type, small company, and the MSME-1 / DPT-3 ticks decide which rules apply. The Compliance tab lists forms that don't apply. Event filings are added by hand, from a meeting or from board papers. |
| I can't approve a filing                  | You prepared it (someone else must review), or the pre-filing check has red items (fix them, or a Partner approves with a reason).                                                                                                     |
| "Uploaded on MCA" says the SRN is wrong   | An SRN has 9 letters and digits, e.g. AB1234567.                                                                                                                                                                                       |
| The workspace is read-only                | The trial has ended or a payment is due — write to info@integratatech.ai.                                                                                                                                                              |
| I didn't get the verification email       | Use **Resend link** on the banner; check spam.                                                                                                                                                                                         |
| No "Read a document" button               | Reading documents is off until Integrata sets up the AI key.                                                                                                                                                                           |
| The AI read a value wrongly               | Correct it in the form before saving — nothing is saved until you press Save.                                                                                                                                                          |
| The form filler didn't match a field      | Click into the portal field and use **Put in selected field**, and send a screenshot to Integrata so the field's wording can be added.                                                                                                 |
| The extension says "Connect again"        | Its connection code was disconnected. Create a new code on the MCA form filler page.                                                                                                                                                   |
| A client user can't see a company         | Link the company to them in the client's Client users tab or Administration → Users.                                                                                                                                                   |

Support: info@integratatech.ai.
