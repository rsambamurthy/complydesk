/**
 * Outgoing email over SMTP (Integrata's Zoho Mail). Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
 * Without them, emails are written to the log instead (local development).
 */
import nodemailer from 'nodemailer';

// Values pasted into a dashboard often carry stray spaces or line breaks; app passwords are shown in groups ("abcd efgh ijkl").
const clean = (v?: string) => v?.trim() || undefined;
const cfg = () => ({
  host: clean(process.env.SMTP_HOST), port: Number(clean(process.env.SMTP_PORT) ?? 465), user: clean(process.env.SMTP_USER), pass: process.env.SMTP_PASS?.replace(/\s+/g, '') || undefined,
  from: process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'ComplyDesk <no-reply@integratatech.ai>',
});
let transport: nodemailer.Transporter | null = null;

export const mailConfigured = () => { const c = cfg(); return !!(c.host && c.user && c.pass); };

export async function sendMail(to: string, subject: string, text: string) {
  const c = cfg();
  if (!mailConfigured()) { console.log(`[mail not configured] to=${to} subject="${subject}"\n${text}`); return; }
  transport ??= nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
  // Zoho (like most providers) only sends "from" the mailbox that signed in ("550 Sender is not allowed to relay").
  // So the address is always SMTP_USER; MAIL_FROM supplies the display name, and a different MAIL_FROM address becomes Reply-To.
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(c.from ?? '');
  const name = (m?.[1] || 'ComplyDesk').trim();
  const fromAddr = m?.[2] ?? (c.from?.includes('@') ? c.from.trim() : c.user!);
  await transport.sendMail({ from: { name, address: c.user! }, to, subject, text, ...(fromAddr.toLowerCase() !== c.user!.toLowerCase() ? { replyTo: fromAddr } : {}) });
}

/** Absolute link into the app (APP_URL, else Railway's public domain, else local dev). */
export function appUrl(path: string) {
  const base = process.env.APP_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:5173');
  return base.replace(/\/$/, '') + path;
}

/** What the app is using (password never shown) — for the platform console's test email. */
export function mailSummary() {
  const c = cfg();
  return { host: c.host ?? null, port: c.port, user: c.user ?? null, passwordLength: c.pass?.length ?? 0, from: c.from };
}

/** Signs in to the mail server without sending, to check the settings. */
export async function verifyMail() {
  const c = cfg();
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
  await t.verify();
}
