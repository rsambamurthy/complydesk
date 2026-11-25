/**
 * Client master: the only place clients, people, shareholders and auditors are written.
 * Used by the API routes and the Excel import. Every write re-syncs the client's compliance calendar.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, schema, HttpError, notFound } from '../lib/core.js';
import type { clientInput, personInput, shareholderInput, auditorInput, yearInput } from '../lib/validators.js';
import { syncClient } from '../compliance/sync.js';
import { assertClientCapacity } from './platform.js';

const { clients, people, shareholders, auditors, clientYears } = schema;
type ClientIn = z.output<typeof clientInput>;

export async function getClient(tenantId: string, id: string) {
  const [c] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.tenantId, tenantId)));
  if (!c) throw notFound('Client not found');
  return c;
}

export async function createClient(tenantId: string, input: ClientIn, opts: { sync?: boolean } = {}) {
  await assertClientCapacity(tenantId);
  const [dupe] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.tenantId, tenantId), eq(clients.cin, input.cin)));
  if (dupe) throw new HttpError(409, `A client with CIN ${input.cin} already exists`, { cin: 'Already added' });
  const [c] = await db.insert(clients).values({ tenantId, ...input }).returning();
  if (opts.sync !== false) await syncClient(tenantId, c.id);
  return c;
}

export async function updateClient(tenantId: string, id: string, input: Partial<ClientIn> & { status?: string }) {
  await getClient(tenantId, id);
  if (input.cin) {
    const [dupe] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.tenantId, tenantId), eq(clients.cin, input.cin)));
    if (dupe && dupe.id !== id) throw new HttpError(409, `A client with CIN ${input.cin} already exists`, { cin: 'Already added' });
  }
  const [c] = await db.update(clients).set(input).where(eq(clients.id, id)).returning();
  await syncClient(tenantId, id);
  return c;
}

/** A director or member named in a register entry can't be deleted (the register would lose the name) — mark them ceased instead. */
async function assertNotInRegisters(tenantId: string, id: string, label: string) {
  const [hit] = await db.select({ id: schema.registerEntries.id }).from(schema.registerEntries)
    .where(and(eq(schema.registerEntries.tenantId, tenantId), sql`${schema.registerEntries.data}::text like ${`%"${id}"%`}`)).limit(1);
  if (hit) throw new HttpError(409, `${label} appears in a statutory register — enter the date they ceased instead of deleting.`);
}

/** One helper for the three child lists (people, shareholders, auditors): same tenant/client checks, same re-sync. */
function childList<T extends typeof people | typeof shareholders | typeof auditors>(table: T, label: string) {
  return {
    async add(tenantId: string, clientId: string, input: Record<string, unknown>, opts: { sync?: boolean } = {}) {
      await getClient(tenantId, clientId);
      const [row] = await (db.insert(table as any).values({ ...input, tenantId, clientId } as any).returning() as Promise<any[]>);
      if (opts.sync !== false) await syncClient(tenantId, clientId);
      return row;
    },
    async update(tenantId: string, id: string, input: Record<string, unknown>) {
      const [row] = await (db.update(table as any).set(input as any).where(and(eq(table.id, id), eq(table.tenantId, tenantId))).returning() as Promise<any[]>);
      if (!row) throw notFound(`${label} not found`);
      await syncClient(tenantId, (row as any).clientId);
      return row;
    },
    async remove(tenantId: string, id: string) {
      if (table !== auditors) await assertNotInRegisters(tenantId, id, label);
      const [row] = await (db.delete(table as any).where(and(eq(table.id, id), eq(table.tenantId, tenantId))).returning() as Promise<any[]>);
      if (!row) throw notFound(`${label} not found`);
      await syncClient(tenantId, (row as any).clientId);
      return row;
    },
  };
}

export const peopleSvc = childList(people, 'Person');
export const shareholdersSvc = childList(shareholders, 'Shareholder');
export const auditorsSvc = childList(auditors, 'Auditor');
export type PersonIn = z.output<typeof personInput>;
export type ShareholderIn = z.output<typeof shareholderInput>;
export type AuditorIn = z.output<typeof auditorInput>;

/** Anchor dates of an FY (AGM held, first board meeting). Only the fields given are changed. */
export async function setYear(tenantId: string, clientId: string, fy: number, input: Partial<z.output<typeof yearInput>>) {
  await getClient(tenantId, clientId);
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await db.insert(clientYears).values({ tenantId, clientId, fy, ...set })
    .onConflictDoUpdate({ target: [clientYears.clientId, clientYears.fy], set: Object.keys(set).length ? set : { fy } });
  return syncClient(tenantId, clientId);
}

export async function clientDetail(tenantId: string, id: string) {
  const client = await getClient(tenantId, id);
  const [ppl, sh, aud, years] = await Promise.all([
    db.select().from(people).where(eq(people.clientId, id)).orderBy(people.name),
    db.select().from(shareholders).where(eq(shareholders.clientId, id)).orderBy(shareholders.name),
    db.select().from(auditors).where(eq(auditors.clientId, id)),
    db.select().from(clientYears).where(eq(clientYears.clientId, id)),
  ]);
  return { client, people: ppl, shareholders: sh, auditors: aud, years };
}
