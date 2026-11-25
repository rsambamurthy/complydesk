/**
 * WhatsApp via Meta's WhatsApp Cloud API: approved template messages only (needed outside a 24-hour chat window).
 * Set WHATSAPP_TOKEN (permanent system-user token), WHATSAPP_PHONE_ID (business phone number ID) and, if needed,
 * WHATSAPP_API_VERSION (default v26.0) and WHATSAPP_LANG (default en). Without them, messages are logged, not sent.
 * Template names and their {{1}}… parameters are in TEMPLATES; create them in WhatsApp Manager with the same names.
 */
export const TEMPLATES = {
  /** {{1}} name, {{2}} form, {{3}} company, {{4}} link */
  approval: { env: 'WA_TEMPLATE_APPROVAL', name: 'complydesk_approval', example: 'Hello {{1}}, {{2}} for {{3}} is ready for your approval before it is filed with MCA. Please review and approve: {{4}}' },
  /** {{1}} name, {{2}} company, {{3}} documents, {{4}} due date, {{5}} link */
  documents: { env: 'WA_TEMPLATE_DOCUMENTS', name: 'complydesk_documents', example: 'Hello {{1}}, for {{2}} we need: {{3}}. Please share them by {{4}}. Upload here: {{5}}' },
  /** {{1}} name, {{2}} what is pending, {{3}} link */
  reminder: { env: 'WA_TEMPLATE_REMINDER', name: 'complydesk_reminder', example: 'Hello {{1}}, a reminder: {{2}}. Open: {{3}}' },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
export const templateName = (k: TemplateKey) => process.env[TEMPLATES[k].env] || TEMPLATES[k].name;

export const whatsappConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

/** Indian mobile → E.164 digits without "+" (WhatsApp's "to"). Null if it doesn't look like a mobile number. */
export function waNumber(mobile?: string | null) {
  const d = String(mobile ?? '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  if (d.length >= 11 && d.length <= 15 && !d.startsWith('0')) return d;
  return null;
}

/** Template parameters can't hold new lines, tabs or more than 4 spaces in a row; keep them short. */
export const waParam = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 900) || '-';

export async function sendTemplate(to: string, key: TemplateKey, params: string[]): Promise<{ status: 'SENT' | 'LOGGED'; id?: string }> {
  const template = templateName(key);
  if (!whatsappConfigured()) { console.log(`[whatsapp not configured] to=${to} template=${template} params=${JSON.stringify(params)}`); return { status: 'LOGGED' }; }
  const v = process.env.WHATSAPP_API_VERSION || 'v26.0';
  const r = await fetch(`https://graph.facebook.com/${v}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
      template: { name: template, language: { code: process.env.WHATSAPP_LANG || 'en' }, components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: waParam(p) })) }] },
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `WhatsApp said ${r.status}`);
  return { status: 'SENT', id: j?.messages?.[0]?.id };
}
