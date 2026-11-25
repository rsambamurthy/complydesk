# WhatsApp

Meta WhatsApp Cloud API, template messages only (`server/src/lib/whatsapp.ts`). Without the env vars messages are logged (`status LOGGED`), not sent.

## Set-up (Integrata, once)
1. A WhatsApp Business Account and a business phone number in Meta Business Manager; a permanent system-user token with `whatsapp_business_messaging`.
2. Railway variables: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`; optional `WHATSAPP_API_VERSION` (default v26.0), `WHATSAPP_LANG` (default `en`).
3. Create these **Utility** templates in WhatsApp Manager (names can be changed with `WA_TEMPLATE_APPROVAL` / `WA_TEMPLATE_DOCUMENTS` / `WA_TEMPLATE_REMINDER`):

| Name | Body |
|---|---|
| `complydesk_approval` | Hello {{1}}, {{2}} for {{3}} is ready for your approval before it is filed with MCA. Please review and approve: {{4}} |
| `complydesk_documents` | Hello {{1}}, for {{2}} we need: {{3}}. Please share them by {{4}}. Upload here: {{5}} |
| `complydesk_reminder` | Hello {{1}}, a reminder: {{2}}. Open: {{3}} |

## How it works
- Firm switch `whatsappEnabled`; per person `users.mobile` + `whatsapp_opt_in_at` (consent recorded by the firm). `waNumber` normalises Indian mobiles to `91XXXXXXXXXX`.
- `services/messaging.ts`: `whatsapp()` (never throws; logs to `message_log`), `approvalRequested` (hooked in `workflow.move` when a filing reaches CLIENT), document requests (`doc_requests`; WhatsApp + email), `runWhatsappReminders` (daily 04:30 UTC: approvals waiting 2+ days, documents due within 2 days; once per 3 days each).
- Web: Users (mobile + consent), Settings (switch + message log), client Documents tab (`components/DocRequests.tsx`).
- Smoke: `scripts/smoke-whatsapp.ts`.
