/**
 * The client compliance report: where one company stands today — overdue (with late-fee estimates), coming up,
 * waiting for the client, done recently, this FY's progress and DSCs expiring. Shown in the app (print / PDF) and
 * emailed to the client: on request, or on the 1st of every month when the firm switches it on.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema, HttpError } from '../lib/core.js';
import { settingsOf } from '../lib/settings.js';
import { appUrl, sendMail } from '../lib/mailer.js';
import { addDays, fyLabel, fyOf, todayIst } from '../compliance/dates.js';
import type { Tenant } from '../db/schema.js';
import { getClient } from './clients.js';
import { listObligations } from './obligations.js';
import { profileOf } from './billing.js';

const { clientReports: cr, users, people } = schema;
type Ob = Awaited<ReturnType<typeof listObligations>>[number];
export interface ReportItem { id: string; form: string; title: string; period: string; dueDate: string; filedOn?: string | null; srn?: string | null; lateFee?: number | null; lateFeeNote?: string | null; stage: string; provisional?: boolean }

const item = (o: Ob): ReportItem => ({
  id: o.id, form: o.form, title: o.title, period: [o.personName, o.periodLabel].filter(Boolean).join(' · '), dueDate: o.dueDate, filedOn: o.filedOn, srn: o.srn,
  lateFee: o.lateFee ?? null, lateFeeNote: o.lateFeeNote ?? null, stage: o.stage, provisional: o.provisional,
});

export async function buildReport(t: Tenant, clientId: string, asOf = todayIst()) {
  const c = await getClient(t.id, clientId);
  const all = await listObligations(t.id, { clientId, bucket: 'all' });
  const open = all.filter((o) => o.status !== 'FILED' && o.status !== 'NOT_APPLICABLE');
  const fy = fyOf(asOf);
  const thisFy = all.filter((o) => o.fy === fy - 1 || o.fy === fy).filter((o) => o.status !== 'NOT_APPLICABLE' && o.dueDate <= addDays(asOf, 365));
  const overdue = open.filter((o) => o.dueDate < asOf).map(item);
  const upcoming = open.filter((o) => o.dueDate >= asOf && o.dueDate <= addDays(asOf, 60)).map(item);
  const waiting = open.filter((o) => o.stage === 'CLIENT').map(item);
  const done = all.filter((o) => o.status === 'FILED' && o.filedOn && o.filedOn >= addDays(asOf, -45) && o.filedOn <= asOf).sort((a, b) => (b.filedOn ?? '').localeCompare(a.filedOn ?? '')).map(item);
  const dsc = (await db.select().from(people).where(eq(people.clientId, clientId)))
    .filter((p) => !p.ceasedOn && p.dscExpiry && p.dscExpiry <= addDays(asOf, 60)).map((p) => ({ name: p.name, dscExpiry: p.dscExpiry!, expired: p.dscExpiry! < asOf }));
  const fyDone = thisFy.filter((o) => o.status === 'FILED').length;
  const exposure = overdue.reduce((s, o) => s + (o.lateFee ?? 0), 0);
  const status = overdue.length ? 'ATTENTION' : upcoming.some((o) => o.dueDate <= addDays(asOf, 15)) || waiting.length || dsc.some((d) => d.expired) ? 'DUE_SOON' : 'ON_TRACK';
  const p = profileOf(t);
  return {
    asOf, fyLabel: fyLabel(fy), status,
    firm: { name: p.legalName || t.name, address: p.address ?? null },
    client: { id: c.id, name: c.name, cin: c.cin },
    counts: { overdue: overdue.length, upcoming: upcoming.length, waiting: waiting.length, done: done.length, fyDone, fyTotal: thisFy.length, exposure },
    overdue, upcoming, waiting, done, dsc,
  };
}
export type Report = Awaited<ReturnType<typeof buildReport>>;

const STATUS_TEXT = { ON_TRACK: 'On track', DUE_SOON: 'Due soon', ATTENTION: 'Needs attention' } as const;
const d = (s?: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const rs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

/** The email: plain text and HTML (inline styles; mail clients ignore style sheets). */
export function renderReport(r: Report) {
  const subject = `${r.client.name}: compliance status as on ${d(r.asOf)} — ${STATUS_TEXT[r.status as keyof typeof STATUS_TEXT]}`;
  const section = (title: string, rows: ReportItem[], cols: (i: ReportItem) => string[], color = '#1c2333') => !rows.length ? '' :
    `<h3 style="font-size:15px;margin:20px 0 6px;color:${color}">${esc(title)} (${rows.length})</h3><table style="border-collapse:collapse;width:100%;font-size:13px">${rows.map((i) =>
      `<tr>${cols(i).map((c, k) => `<td style="border-bottom:1px solid #e5e7eb;padding:6px 4px;${k ? 'color:#4b5563' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c2333;max-width:680px">
<p style="margin:0;color:#6b7280;font-size:12px">${esc(r.firm.name)}</p>
<h2 style="margin:4px 0 2px;font-size:19px">${esc(r.client.name)}</h2>
<p style="margin:0 0 12px;color:#6b7280">CIN ${esc(r.client.cin)} · Compliance status as on ${d(r.asOf)}</p>
<p style="display:inline-block;padding:6px 12px;border-radius:99px;font-weight:bold;background:${r.status === 'ATTENTION' ? '#fdecea;color:#b42318' : r.status === 'DUE_SOON' ? '#fff4e5;color:#b45309' : '#e7f6ec;color:#15803d'}">${STATUS_TEXT[r.status as keyof typeof STATUS_TEXT]}</p>
<p>${r.counts.overdue} overdue${r.counts.exposure ? ` (late fees about ${rs(r.counts.exposure)} so far)` : ''} · ${r.counts.upcoming} due in the next 60 days · ${r.counts.fyDone} of ${r.counts.fyTotal} done for ${r.fyLabel}</p>
${section('Overdue', r.overdue, (i) => [`<b>${esc(i.form)}</b> ${esc(i.title)}${i.period ? ` · ${esc(i.period)}` : ''}`, `was due ${d(i.dueDate)}`, i.lateFee ? `late fee ~${rs(i.lateFee)}` : ''], '#b42318')}
${section('Waiting for your approval', r.waiting, (i) => [`<b>${esc(i.form)}</b> ${esc(i.title)}${i.period ? ` · ${esc(i.period)}` : ''}`, `due ${d(i.dueDate)}`, ''], '#b45309')}
${section('Coming up in the next 60 days', r.upcoming, (i) => [`<b>${esc(i.form)}</b> ${esc(i.title)}${i.period ? ` · ${esc(i.period)}` : ''}`, `due ${d(i.dueDate)}${i.provisional ? ' (est.)' : ''}`, ''])}
${section('Done recently', r.done, (i) => [`<b>${esc(i.form)}</b> ${esc(i.title)}${i.period ? ` · ${esc(i.period)}` : ''}`, `filed ${d(i.filedOn)}`, i.srn ? `SRN ${esc(i.srn)}` : ''], '#15803d')}
${r.dsc.length ? `<h3 style="font-size:15px;margin:20px 0 6px;color:#b45309">Digital signatures (DSC) to renew</h3><ul style="margin:0;padding-left:18px">${r.dsc.map((x) => `<li>${esc(x.name)} — ${x.expired ? 'expired' : 'expires'} ${d(x.dscExpiry)}</li>`).join('')}</ul>` : ''}
<p style="margin-top:22px;color:#6b7280;font-size:12px">Late fees are estimates. Dates marked “est.” depend on a date not yet recorded (usually the AGM). Questions? Reply to this email.<br>Prepared by ${esc(r.firm.name)} with ComplyDesk.</p></div>`;
  const line = (i: ReportItem, extra: string) => `  • ${i.form} ${i.title}${i.period ? ` · ${i.period}` : ''} — ${extra}`;
  const text = [`${r.client.name} (CIN ${r.client.cin})`, `Compliance status as on ${d(r.asOf)}: ${STATUS_TEXT[r.status as keyof typeof STATUS_TEXT]}`, '',
    ...(r.overdue.length ? ['OVERDUE', ...r.overdue.map((i) => line(i, `was due ${d(i.dueDate)}${i.lateFee ? `, late fee ~${rs(i.lateFee)}` : ''}`)), ''] : []),
    ...(r.waiting.length ? ['WAITING FOR YOUR APPROVAL', ...r.waiting.map((i) => line(i, `due ${d(i.dueDate)}`)), ''] : []),
    ...(r.upcoming.length ? ['COMING UP (60 DAYS)', ...r.upcoming.map((i) => line(i, `due ${d(i.dueDate)}`)), ''] : []),
    ...(r.done.length ? ['DONE RECENTLY', ...r.done.map((i) => line(i, `filed ${d(i.filedOn)}${i.srn ? `, SRN ${i.srn}` : ''}`)), ''] : []),
    ...(r.dsc.length ? ['DSC TO RENEW', ...r.dsc.map((x) => `  • ${x.name} — ${x.expired ? 'expired' : 'expires'} ${d(x.dscExpiry)}`), ''] : []),
    `Prepared by ${r.firm.name}.`].join('\n');
  return { subject, text, html };
}

/** Who the report goes to: the client's accounts / company email and its active client users. */
export async function recipientsFor(t: Tenant, clientId: string) {
  const c = await getClient(t.id, clientId);
  const cu = await db.select({ email: users.email }).from(users)
    .where(and(eq(users.tenantId, t.id), eq(users.status, 'ACTIVE'), sql`${users.clientIds} @> ${JSON.stringify([clientId])}::jsonb`));
  const list = [(c as any).billing?.email, c.email, ...cu.map((u) => u.email)].filter(Boolean).map((e: string) => e.trim().toLowerCase());
  return [...new Set(list)];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function sendReport(t: Tenant, clientId: string, opts: { to?: string[]; by?: string | null; period?: string | null } = {}) {
  const to = [...new Set((opts.to?.length ? opts.to : await recipientsFor(t, clientId)).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) throw new HttpError(400, 'No email address for this client — add one in the client’s Billing details or Details, or give a client user access.');
  const bad = to.find((e) => !EMAIL_RE.test(e));
  if (bad) throw new HttpError(400, `Not an email address: ${bad}`, { to: 'Check the addresses' });
  if (to.length > 10) throw new HttpError(400, 'Up to 10 addresses', { to: 'Up to 10 addresses' });
  const r = await buildReport(t, clientId);
  if (opts.period) {
    const [claimed] = await db.insert(cr).values({ tenantId: t.id, clientId, period: opts.period, sentTo: to, sentBy: null, summary: r.counts }).onConflictDoNothing().returning();
    if (!claimed) return { sent: false, to };
  }
  const mail = renderReport(r);
  const footer = `\n\nOpen in ComplyDesk: ${appUrl(`/clients/${clientId}`)}`;
  try { for (const addr of to) await sendMail(addr, mail.subject, mail.text + footer, mail.html); }
  catch (e) { if (opts.period) await db.delete(cr).where(and(eq(cr.clientId, clientId), eq(cr.period, opts.period))); throw e; }
  if (!opts.period) await db.insert(cr).values({ tenantId: t.id, clientId, period: null, sentTo: to, sentBy: opts.by ?? null, summary: r.counts });
  return { sent: true, to };
}

export async function reportLog(tenantId: string, clientId: string) {
  return db.select({ id: cr.id, period: cr.period, sentTo: cr.sentTo, sentAt: cr.sentAt, summary: cr.summary, by: users.name })
    .from(cr).leftJoin(users, eq(users.id, cr.sentBy)).where(and(eq(cr.tenantId, tenantId), eq(cr.clientId, clientId))).orderBy(desc(cr.sentAt)).limit(24);
}

/** 1st of the month (India time): every firm that switched it on emails each active client with an address. */
export async function runMonthlyReports(today = todayIst()) {
  if (!today.endsWith('-01')) return 0;
  const period = today.slice(0, 7);
  const ts = await db.select().from(schema.tenants);
  let sent = 0;
  for (const t of ts) {
    if (!['ACTIVE', 'TRIAL'].includes(t.status) || !settingsOf(t).monthlyClientReport) continue;
    const cs = await db.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.tenantId, t.id), eq(schema.clients.status, 'ACTIVE')));
    for (const c of cs) {
      try { if ((await recipientsFor(t, c.id)).length && (await sendReport(t, c.id, { period })).sent) sent++; }
      catch (e) { console.error(`monthly report ${t.slug}/${c.id} failed:`, (e as Error).message); }
    }
  }
  console.log(`monthly client reports ${period}: ${sent}`);
  return sent;
}
