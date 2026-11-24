/**
 * Database schema. One workspace (tenant) = one CS firm or one in-house secretarial team.
 * Every business table carries tenant_id; every query filters by it (see lib/tenant.ts).
 */
import { randomUUID } from 'node:crypto';
import { boolean, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { DueRule, Applies, LateFee } from '../compliance/types.js';

const id = () => text('id').primaryKey().$defaultFn(() => randomUUID());
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tenantId = () => text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' });

export interface TenantSettings { sessionHours?: number; reminderDays?: number[] }

export const tenants = pgTable('tenants', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  settings: jsonb('settings').$type<TenantSettings>().notNull().default({}),
  /** PENDING_APPROVAL | TRIAL | ACTIVE | SUSPENDED (see services/platform.ts accessState) */
  status: text('status').notNull().default('ACTIVE'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  /** Paid until (manual activation now; Razorpay later). Null while ACTIVE = no end. */
  paidUntil: timestamp('paid_until', { withTimezone: true }),
  icsiNumber: text('icsi_number'),
  city: text('city'),
  gstin: text('gstin'),
  contactEmail: text('contact_email'),
  contactMobile: text('contact_mobile'),
  source: text('source').notNull().default('ADMIN'),
  platformNotes: text('platform_notes'),
  createdAt: createdAt(),
});

/** Integrata-wide settings (one row, id 'default'), changed from the platform console. */
export const platformSettings = pgTable('platform_settings', {
  id: text('id').primaryKey().default('default'),
  /** New sign-ups wait for Integrata's approval before they can use the workspace. */
  requireApproval: boolean('require_approval').notNull().default(false),
  trialDays: integer('trial_days').notNull().default(30),
  /** Client companies allowed during the trial (null = no limit). */
  trialClientLimit: integer('trial_client_limit').default(10),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One-time links (email verification; later password reset and invites). Only the hash is stored. */
export const authTokens = pgTable('auth_tokens', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  purpose: text('purpose').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Every platform action on a workspace (approve, suspend, extend trial…). */
export const platformEvents = pgTable('platform_events', {
  id: id(),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  by: text('by'),
  data: jsonb('data'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  /** ACTIVE | DISABLED */
  status: text('status').notNull().default('ACTIVE'),
  passwordHash: text('password_hash'),
  /** Client users only see these clients (empty = firm staff, sees what their role allows). */
  clientIds: jsonb('client_ids').$type<string[]>().notNull().default([]),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  mobile: text('mobile'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_tenant_email_uq').on(t.tenantId, t.email)]);

export const roles = pgTable('roles', {
  id: id(),
  tenantId: tenantId(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('roles_tenant_key_uq').on(t.tenantId, t.key)]);

export const userRoles = pgTable('user_roles', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  tenantId: tenantId(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** A company the workspace looks after. */
export const clients = pgTable('clients', {
  id: id(),
  tenantId: tenantId(),
  cin: text('cin').notNull(),
  name: text('name').notNull(),
  /** PRIVATE | OPC (MVP); PUBLIC / LLP later */
  companyType: text('company_type').notNull().default('PRIVATE'),
  /** Small company under s.2(85) — fewer board meetings, MGT-7A. */
  smallCompany: boolean('small_company').notNull().default(false),
  incorporationDate: date('incorporation_date'),
  rocOffice: text('roc_office'),
  registeredOffice: text('registered_office'),
  email: text('email'),
  authorisedCapital: numeric('authorised_capital'),
  paidUpCapital: numeric('paid_up_capital'),
  /** Applicability flags the rules look at: msmeDues (owes MSME suppliers > 45 days), depositsOrLoans (DPT-3). */
  flags: jsonb('flags').$type<Record<string, boolean>>().notNull().default({}),
  /** Staff member responsible. */
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  /** ACTIVE | ARCHIVED */
  status: text('status').notNull().default('ACTIVE'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('clients_tenant_cin_uq').on(t.tenantId, t.cin)]);

/** Directors and KMP of a client. */
export const people = pgTable('people', {
  id: id(),
  tenantId: tenantId(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  din: text('din'),
  pan: text('pan'),
  email: text('email'),
  /** DIRECTOR | MANAGING_DIRECTOR | WHOLE_TIME_DIRECTOR | NOMINEE_DIRECTOR | INDEPENDENT_DIRECTOR | CEO | CFO | CS */
  designation: text('designation').notNull(),
  appointedOn: date('appointed_on'),
  ceasedOn: date('ceased_on'),
  dscExpiry: date('dsc_expiry'),
  /** DIN allotment date and the FY (start year, 2025 = FY 2025-26) of the last DIR-3 KYC filed: they start the 3-year KYC cycle. */
  dinAllottedOn: date('din_allotted_on'),
  kycLastFiledFy: integer('kyc_last_filed_fy'),
  createdAt: createdAt(),
}, (t) => [index('people_client_ix').on(t.clientId)]);

export const shareholders = pgTable('shareholders', {
  id: id(),
  tenantId: tenantId(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  pan: text('pan'),
  folio: text('folio'),
  shareClass: text('share_class').notNull().default('EQUITY'),
  shares: integer('shares').notNull(),
  faceValue: numeric('face_value').notNull().default('10'),
  createdAt: createdAt(),
}, (t) => [index('shareholders_client_ix').on(t.clientId)]);

export const auditors = pgTable('auditors', {
  id: id(),
  tenantId: tenantId(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  firmName: text('firm_name').notNull(),
  frn: text('frn'),
  appointedOn: date('appointed_on'),
  /** First FY (start year) of the term and the FY whose AGM ends it (5-year term = start + 4). */
  termFromFy: integer('term_from_fy'),
  termToFy: integer('term_to_fy'),
  current: boolean('current').notNull().default(true),
  createdAt: createdAt(),
});

/** Per client and FY: the dates other due dates hang off (AGM held, first board meeting…). */
export const clientYears = pgTable('client_years', {
  id: id(),
  tenantId: tenantId(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  fy: integer('fy').notNull(),
  agmDate: date('agm_date'),
  firstBoardMeetingDate: date('first_board_meeting_date'),
}, (t) => [uniqueIndex('client_years_uq').on(t.clientId, t.fy)]);

/**
 * Compliance rules as data. tenant_id null = built-in catalogue (seeded from compliance/catalogue.ts);
 * a workspace row with the same code overrides the built-in one.
 */
export const rules = pgTable('rules', {
  id: id(),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  form: text('form').notNull(),
  title: text('title').notNull(),
  law: text('law'),
  /** ANNUAL | HALF_YEARLY | QUARTERLY | PER_DIRECTOR | EVENT */
  frequency: text('frequency').notNull(),
  applies: jsonb('applies').$type<Applies>().notNull().default({}),
  due: jsonb('due').$type<DueRule>().notNull(),
  lateFee: jsonb('late_fee').$type<LateFee>(),
  /** For EVENT rules: the event that starts the clock. */
  event: text('event'),
  notes: text('notes'),
  effectiveFrom: date('effective_from'),
  effectiveTo: date('effective_to'),
  active: boolean('active').notNull().default(true),
  /** Built-in rows: CATALOGUE (as shipped in catalogue.ts, refreshed on deploy) or PLATFORM (edited / added by Integrata — deploys leave it alone). Workspace rows: WORKSPACE. */
  source: text('source').notNull().default('CATALOGUE'),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('rules_tenant_code_uq').on(t.tenantId, t.code)]);

/** Every change to a rule — by Integrata (tenant_id null) or a workspace — with the rule before and after. */
export const ruleHistory = pgTable('rule_history', {
  id: id(),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  /** create | update | revert | delete */
  action: text('action').notNull(),
  by: text('by'),
  before: jsonb('before'),
  after: jsonb('after'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('rule_history_code_ix').on(t.code)]);

/** One thing a client must do by a date. Generated by the engine; status is kept when dates are recomputed. */
export const obligations = pgTable('obligations', {
  id: id(),
  tenantId: tenantId(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  ruleCode: text('rule_code').notNull(),
  form: text('form').notNull(),
  title: text('title').notNull(),
  fy: integer('fy').notNull(),
  /** Stable key within the client: rule + period (+ person / event). */
  key: text('key').notNull(),
  periodLabel: text('period_label').notNull(),
  personId: text('person_id').references(() => people.id, { onDelete: 'cascade' }),
  eventDate: date('event_date'),
  dueDate: date('due_date').notNull(),
  /** Due date is an estimate until its anchor (e.g. the AGM date) is known. */
  provisional: boolean('provisional').notNull().default(false),
  /** OPEN | IN_PROGRESS | FILED | NOT_APPLICABLE */
  status: text('status').notNull().default('OPEN'),
  /** Generated by the engine (AUTO) or added by hand for an event (MANUAL). */
  source: text('source').notNull().default('AUTO'),
  filedOn: date('filed_on'),
  srn: text('srn'),
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  /** Engine no longer produces it (e.g. a flag changed) and it was never started. */
  stale: boolean('stale').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('obligations_client_key_uq').on(t.clientId, t.key), index('obligations_due_ix').on(t.tenantId, t.dueDate)]);

export const auditLog = pgTable('audit_log', {
  id: id(),
  tenantId: tenantId(),
  userId: text('user_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  data: jsonb('data'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Auditor = typeof auditors.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type Obligation = typeof obligations.$inferSelect;
