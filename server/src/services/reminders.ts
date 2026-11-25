/**
 * Daily reminder email: one digest per person, only when there is something in it.
 *
 * Firm staff — filings assigned to them (unassigned ones go to the client's "handled by" person, else the
 * firm admins) due in exactly N days (firm setting, default 15 / 7 / 1) or overdue; filings waiting for their
 * review; DSC expiring in 30 / 15 / 7 / 1 days; minutes due for signing. Client users (if the firm turns it on)
 * — their companies' items on the same days, and filings waiting for their approval.
 * reminder_log keeps it to one email per person per day, whatever restarts or instances.
 */
import { and, eq, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '../lib/core.js';
import { settingsOf } from '../lib/settings.js';
import { sendMail, appUrl } from '../lib/mailer.js';
import { addDays, daysBetween, todayIso } from '../compliance/dates.js';
import type { Tenant, User } from '../db/schema.js';

const { obligations: o, clients: c, users: u, roles: r, userRoles: ur, people: p, meetings: m, reminderLog } = schema;
const DONE = ['FILED', 'NOT_APPLICABLE'];
const DSC_DAYS = [30, 15, 7, 1];

export interface DigestItem { group: 'overdue' | 'due' | 'review' | 'approval' | 'dsc' | 'minutes'; text: string; date: string; link: string }

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Everything due or waiting in a workspace today, with who it's for. */
async function workspaceItems(t: Tenant, today: string) {
  const s = settingsOf(t);
  const rows = await db.select({ u, key: r.key, perms: r.permissions }).from(u).leftJoin(ur, eq(ur.userId, u.id)).leftJoin(r, eq(r.id, ur.roleId))
    .where(and(eq(u.tenantId, t.id), eq(u.status, 'ACTIVE')));
  const byUser = new Map<string, { u: User; roleKeys: string[]; perms: string[][] }>();
  for (const row of rows) {
    const x = byUser.get(row.u.id) ?? { u: row.u, roleKeys: [], perms: [] };
    if (row.key) { x.roleKeys.push(row.key); x.perms.push(row.perms ?? []); }
    byUser.set(row.u.id, x);
  }
  const users = [...byUser.values()];
  const staff = users.filter((x) => !x.u.clientIds.length);
  const admins = staff.filter((x) => x.roleKeys.includes('ADMIN')).map((x) => x.u.id);
  const canReview = (x: (typeof users)[number]) => x.perms.flat().includes('compliance.approve');
  const owners = new Map((await db.select({ id: c.id, ownerId: c.ownerId, name: c.name }).from(c).where(and(eq(c.tenantId, t.id), eq(c.status, 'ACTIVE')))).map((x) => [x.id, x]));
  const forStaff = (assigneeId: string | null, clientId: string) => assigneeId ? [assigneeId] : owners.get(clientId)?.ownerId ? [owners.get(clientId)!.ownerId!] : admins;

  const out = new Map<string, DigestItem[]>();
  const add = (userIds: string[], item: DigestItem) => { for (const id of userIds) out.set(id, [...(out.get(id) ?? []), item]); };
  const clientUsersOf = (clientId: string, perm?: string) => users.filter((x) => x.u.clientIds.includes(clientId) && (!perm || x.perms.flat().includes(perm))).map((x) => x.u.id);

  // Filings and meetings due on a reminder day, or overdue.
  const days = s.reminderDays.map((d) => addDays(today, d));
  const obs = await db.select({ o, client: c.name }).from(o).innerJoin(c, eq(c.id, o.clientId))
    .where(and(eq(o.tenantId, t.id), eq(o.stale, false), eq(c.status, 'ACTIVE'), notInArray(o.status, DONE),
      s.reminderOverdue ? sql`(${o.dueDate} in ${days.length ? days : ['1900-01-01']} or ${o.dueDate} < ${today})` : inArray(o.dueDate, days.length ? days : ['1900-01-01'])));
  for (const { o: x, client } of obs) {
    const late = x.dueDate < today;
    const left = daysBetween(today, x.dueDate);
    const item: DigestItem = { group: late ? 'overdue' : 'due', date: x.dueDate, link: appUrl(`/clients/${x.clientId}`),
      text: `${x.form}${x.periodLabel ? ` (${x.periodLabel})` : ''} — ${client} — ${late ? `${-left} day${left === -1 ? '' : 's'} late` : left === 0 ? 'due today' : `due in ${left} day${left === 1 ? '' : 's'}`}, ${fmt(x.dueDate)}` };
    add(forStaff(x.assigneeId, x.clientId), item);
    if (s.reminderClientUsers) add(clientUsersOf(x.clientId), item);
  }

  // Waiting for a reviewer / for the client's approval.
  const waiting = await db.select({ o, client: c.name }).from(o).innerJoin(c, eq(c.id, o.clientId)).where(and(eq(o.tenantId, t.id), inArray(o.stage, ['REVIEW', 'CLIENT'])));
  for (const { o: x, client } of waiting) {
    const link = appUrl(`/calendar?bucket=${x.stage === 'REVIEW' ? 'review' : 'client'}`);
    if (x.stage === 'REVIEW') add(staff.filter((y) => canReview(y) && y.u.id !== x.preparedById).map((y) => y.u.id), { group: 'review', date: x.dueDate, link, text: `${x.form} — ${client} — waiting for your review (due ${fmt(x.dueDate)})` });
    else add(clientUsersOf(x.clientId, 'compliance.client_approve'), { group: 'approval', date: x.dueDate, link, text: `${x.form} — ${client} — waiting for your approval (due ${fmt(x.dueDate)})` });
  }

  // DSC expiry of directors and KMP in office.
  const dsc = await db.select({ p, client: c.name }).from(p).innerJoin(c, eq(c.id, p.clientId))
    .where(and(eq(p.tenantId, t.id), eq(c.status, 'ACTIVE'), isNull(p.ceasedOn), inArray(p.dscExpiry, DSC_DAYS.map((d) => addDays(today, d)))));
  for (const { p: x, client } of dsc) add(forStaff(null, x.clientId), { group: 'dsc', date: x.dscExpiry!, link: appUrl(`/clients/${x.clientId}`), text: `DSC of ${x.name} (${client}) expires on ${fmt(x.dscExpiry!)}` });

  // Minutes not signed: on reminder days before the 30-day limit, and daily once past it.
  const mins = await db.select({ m, client: c.name }).from(m).innerJoin(c, eq(c.id, m.clientId)).where(and(eq(m.tenantId, t.id), eq(m.status, 'HELD'), lte(m.heldOn, today)));
  for (const { m: x, client } of mins) {
    const due = addDays(x.heldOn!, 30);
    if (!(days.includes(due) || (s.reminderOverdue && due < today))) continue;
    add(forStaff(null, x.clientId), { group: 'minutes', date: due, link: appUrl(`/meetings/${x.id}`), text: `Minutes of ${x.title} — ${client} — ${due < today ? 'past' : 'to be signed by'} ${fmt(due)}` });
  }
  return { out, users: new Map(users.map((x) => [x.u.id, x.u])) };
}

const GROUPS: [DigestItem['group'], string][] = [['overdue', 'Overdue'], ['review', 'Waiting for your review'], ['approval', 'Waiting for your approval'], ['due', 'Coming up'], ['minutes', 'Minutes to sign'], ['dsc', 'DSC expiring']];

export function renderDigest(user: Pick<User, 'name'>, tenantName: string, items: DigestItem[]) {
  const sorted = (g: string) => items.filter((i) => i.group === g).sort((a, b) => a.date.localeCompare(b.date));
  const parts = GROUPS.filter(([g]) => sorted(g).length);
  const subject = `ComplyDesk: ${parts.map(([g, l]) => `${sorted(g).length} ${l.toLowerCase()}`).join(', ')}`;
  const text = [`Hello ${user.name},`, '', `Here is what needs attention in ${tenantName} today:`, '',
    ...parts.flatMap(([g, l]) => [`${l.toUpperCase()}`, ...sorted(g).map((i) => `  • ${i.text}\n    ${i.link}`), '']),
    `Open ComplyDesk: ${appUrl('/dashboard')}`, '', 'You get this email because items are assigned to you. Change it under Administration → Users (“Daily reminder email”).', '— ComplyDesk by Integrata'].join('\n');
  const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c2333;max-width:640px">
<p>Hello ${esc(user.name)},</p><p>Here is what needs attention in <b>${esc(tenantName)}</b> today:</p>
${parts.map(([g, l]) => `<h3 style="font-size:15px;margin:18px 0 6px;color:${g === 'overdue' ? '#b42318' : '#2f3a8f'}">${l} (${sorted(g).length})</h3><ul style="padding-left:18px;margin:0">${sorted(g).map((i) => `<li style="margin:4px 0"><a href="${esc(i.link)}" style="color:#1c2333">${esc(i.text)}</a></li>`).join('')}</ul>`).join('')}
<p style="margin-top:20px"><a href="${esc(appUrl('/dashboard'))}" style="background:#2f3a8f;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Open ComplyDesk</a></p>
<p style="color:#6b7280;font-size:12px">You get this email because items are assigned to you. Turn it off under Administration → Users (“Daily reminder email”).</p></div>`;
  return { subject, text, html };
}

/** Sends today's digests for one workspace. `onlyUserId` + `force` = "send me mine now" (ignores the daily log). */
export async function runWorkspace(t: Tenant, today = todayIso(), opts: { onlyUserId?: string; force?: boolean } = {}) {
  const { out, users } = await workspaceItems(t, today);
  let sent = 0;
  for (const [userId, items] of out) {
    if (opts.onlyUserId && userId !== opts.onlyUserId) continue;
    const user = users.get(userId);
    if (!user || (user.remindersOff && !opts.force) || !items.length) continue;
    if (!opts.force) {
      const [claimed] = await db.insert(reminderLog).values({ userId, day: today, tenantId: t.id, items: items.length }).onConflictDoNothing().returning();
      if (!claimed) continue; // already sent today
    }
    const mail = renderDigest(user, t.name, items);
    try { await sendMail(user.email, mail.subject, mail.text, mail.html); sent++; }
    catch (e: any) {
      console.error(`reminder to ${user.email} failed:`, e.message);
      if (!opts.force) await db.delete(reminderLog).where(and(eq(reminderLog.userId, userId), eq(reminderLog.day, today)));
      if (opts.force) throw e;
    }
  }
  return { sent, people: out.size };
}

/** What a person would get today (for the settings page preview). */
export async function previewFor(t: Tenant, userId: string, today = todayIso()) {
  const { out } = await workspaceItems(t, today);
  return out.get(userId) ?? [];
}

export async function runAll(today = todayIso()) {
  const ts = await db.select().from(schema.tenants).where(ne(schema.tenants.status, 'SUSPENDED'));
  let sent = 0;
  for (const t of ts) {
    if (t.status === 'PENDING_APPROVAL') continue;
    try { sent += (await runWorkspace(t, today)).sent; } catch (e) { console.error(`reminders for ${t.slug} failed:`, e); }
  }
  console.log(`reminders ${today}: ${sent} email(s)`);
  return sent;
}
