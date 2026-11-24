/**
 * Outgoing email over SMTP (Integrata's Zoho Mail). Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
 * Without them, emails are written to the log instead (local development).
 */
import nodemailer from 'nodemailer';

const cfg = () => ({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 465), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'ComplyDesk <no-reply@integratatech.ai>',
});
let transport: nodemailer.Transporter | null = null;

export const mailConfigured = () => { const c = cfg(); return !!(c.host && c.user && c.pass); };

export async function sendMail(to: string, subject: string, text: string) {
  const c = cfg();
  if (!mailConfigured()) { console.log(`[mail not configured] to=${to} subject="${subject}"\n${text}`); return; }
  transport ??= nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
  await transport.sendMail({ from: c.from, to, subject, text });
}

/** Absolute link into the app (APP_URL, else Railway's public domain, else local dev). */
export function appUrl(path: string) {
  const base = process.env.APP_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:5173');
  return base.replace(/\/$/, '') + path;
}
