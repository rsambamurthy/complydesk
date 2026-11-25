/**
 * Database schema. One workspace (tenant) = one CS firm or one in-house secretarial team.
 * Every business table carries tenant_id; every query filters by it (see lib/tenant.ts).
 */
import { randomUUID } from 'node:crypto';
import { boolean, customType, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { DueRule, Applies, LateFee } from '../compliance/types.js';

const id = () => text('id').primaryKey().$defaultFn(() => randomUUID());
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tenantId = () => text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' });

export interface TenantSettings {
  sessionHours?: number;
  /** Reminder emails: days before the due date (default 15, 7, 1), overdue items, and client users' own digest. */
  reminderDays?: number[]; reminderOverdue?: boolean; reminderClientUsers?: boolean;
  /** Filing workflow: partner review before filing (maker-checker) and the client's approval. */
  requireReview?: boolean; requireClientApproval?: boolean;
  /** No approval or filing while the pre-filing check has things to fix. */
  blockOnCheckErrors?: boolean;
}

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
  /** Opted out of the daily reminder email. */
  remindersOff: boolean('reminders_off').notNull().default(false),
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
  /** Extra company details MCA forms ask for (PAN, phone, website, business activity codes…) — see eforms/forms.ts. */
  profile: jsonb('profile').$type<Record<string, string>>().notNull().default({}),
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
  /** OPEN | IN_PROGRESS | FILED | NOT_APPLICABLE — follows `stage` (services/workflow.ts STAGE_STATUS). */
  status: text('status').notNull().default('OPEN'),
  /** Filing workflow: TODO → DATA → DRAFTED → REVIEW → CLIENT → READY → FILED → APPROVED (or RESUBMIT); NA = not applicable. */
  stage: text('stage').notNull().default('TODO'),
  preparedById: text('prepared_by_id').references(() => users.id, { onDelete: 'set null' }),
  reviewedById: text('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  clientApprovedById: text('client_approved_by_id').references(() => users.id, { onDelete: 'set null' }),
  clientApprovedAt: timestamp('client_approved_at', { withTimezone: true }),
  /** Generated by the engine (AUTO) or added by hand for an event (MANUAL). */
  source: text('source').notNull().default('AUTO'),
  filedOn: date('filed_on'),
  srn: text('srn'),
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  /** Values typed for this filing's MCA form that the records don't hold (turnover, reason for cessation…). */
  formData: jsonb('form_data').$type<Record<string, string>>().notNull().default({}),
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

// ---- Meetings (board, AGM, EGM) ------------------------------------------------------------------------------

/** A board or general meeting of a client. Status: SCHEDULED → NOTICE_SENT → HELD → MINUTES_SIGNED (or CANCELLED). */
export const meetings = pgTable('meetings', {
  id: id(),
  tenantId: tenantId(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  /** BOARD | AGM | EGM */
  type: text('type').notNull(),
  fy: integer('fy').notNull(),
  title: text('title').notNull(),
  date: date('date').notNull(),
  time: text('time'),
  /** PHYSICAL | VIDEO | HYBRID */
  mode: text('mode').notNull().default('PHYSICAL'),
  venue: text('venue'),
  videoLink: text('video_link'),
  status: text('status').notNull().default('SCHEDULED'),
  noticeSentOn: date('notice_sent_on'),
  /** Consent to hold the meeting at shorter notice (general meetings: members; board: urgent business with an independent director present). */
  shorterNotice: boolean('shorter_notice').notNull().default(false),
  heldOn: date('held_on'),
  chairpersonId: text('chairperson_id').references(() => people.id, { onDelete: 'set null' }),
  /** General meetings: members present in person (quorum, Sec 103). */
  membersPresent: integer('members_present'),
  minutes: text('minutes'),
  minutesSignedOn: date('minutes_signed_on'),
  /** The calendar item this meeting satisfied (board meeting for the period / AGM). */
  obligationId: text('obligation_id').references(() => obligations.id, { onDelete: 'set null' }),
  createdBy: text('created_by'),
  createdAt: createdAt(),
}, (t) => [index('meetings_client_ix').on(t.clientId), index('meetings_tenant_date_ix').on(t.tenantId, t.date)]);

/** One agenda item; a resolution when resolutionType isn't NONE. Passing it creates the filings in `filings`. */
export const meetingItems = pgTable('meeting_items', {
  id: id(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  templateKey: text('template_key'),
  title: text('title').notNull(),
  /** NONE | BOARD | ORDINARY | SPECIAL */
  resolutionType: text('resolution_type').notNull().default('NONE'),
  text: text('text'),
  personId: text('person_id').references(() => people.id, { onDelete: 'set null' }),
  /** Event filings to create when passed (rule codes, e.g. DIR12) and annual items it completes (e.g. MBP1_DIR8). */
  filings: jsonb('filings').$type<string[]>().notNull().default([]),
  completes: jsonb('completes').$type<string[]>().notNull().default([]),
  /** PENDING | PASSED | NOT_PASSED | NOTED | DEFERRED */
  outcome: text('outcome').notNull().default('PENDING'),
  createdObligationIds: jsonb('created_obligation_ids').$type<string[]>().notNull().default([]),
});

/** Directors' attendance (board and general meetings). */
export const meetingAttendance = pgTable('meeting_attendance', {
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  /** PRESENT | VIDEO | LEAVE | ABSENT */
  status: text('status').notNull(),
}, (t) => [primaryKey({ columns: [t.meetingId, t.personId] })]);

export type Meeting = typeof meetings.$inferSelect;
export type MeetingItem = typeof meetingItems.$inferSelect;

/** What happened to a filing: each workflow step, with who, when and an optional note. */
export const obligationEvents = pgTable('obligation_events', {
  id: id(),
  obligationId: text('obligation_id').notNull().references(() => obligations.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  fromStage: text('from_stage'),
  toStage: text('to_stage'),
  note: text('note'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  userName: text('user_name'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('obligation_events_ob_ix').on(t.obligationId)]);

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** A file attached to a filing or a meeting. The bytes live in the storage driver (lib/storage.ts). */
export const attachments = pgTable('attachments', {
  id: id(),
  tenantId: tenantId(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  /** obligation | meeting */
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedById: text('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
  uploadedByName: text('uploaded_by_name'),
  createdAt: createdAt(),
}, (t) => [index('attachments_entity_ix').on(t.entity, t.entityId)]);

/** File bytes for the default "db" storage driver (no outside service needed). */
export const fileBlobs = pgTable('file_blobs', {
  key: text('key').primaryKey(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

/** One reminder email per person per day (so a restart or a second instance never sends twice). */
export const reminderLog = pgTable('reminder_log', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  tenantId: tenantId(),
  items: integer('items').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

/**
 * Documents read by AI to fill in forms (MCA master data, challans, MGT-7, financials…). The file is kept until it is
 * attached to the client / filing it filled in, or purged after a few days. `result` is what was read, before review.
 */
export const extractions = pgTable('extractions', {
  id: id(),
  tenantId: tenantId(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  docType: text('doc_type').notNull(),
  clientId: text('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  obligationId: text('obligation_id'),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  storageKey: text('storage_key'),
  /** READ | FAILED | APPLIED | ATTACHED */
  status: text('status').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  error: text('error'),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: createdAt(),
}, (t) => [index('extractions_tenant_ix').on(t.tenantId, t.createdAt)]);

/** Reviewer checks of a draft form against the records (AI reads the draft; code compares). Latest one is shown on the filing. */
export const filingChecks = pgTable('filing_checks', {
  id: id(),
  tenantId: tenantId(),
  obligationId: text('obligation_id').notNull().references(() => obligations.id, { onDelete: 'cascade' }),
  attachmentId: text('attachment_id'),
  fileName: text('file_name'),
  findings: jsonb('findings').$type<{ level: string; text: string; source: string }[]>().notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  userName: text('user_name'),
  createdAt: createdAt(),
}, (t) => [index('filing_checks_ob_ix').on(t.obligationId, t.createdAt)]);

/** Connections of the ComplyDesk browser extension (one per browser), per user. Token shown once; stored as sha256. */
export const apiTokens = pgTable('api_tokens', {
  id: id(),
  tenantId: tenantId(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('api_tokens_hash_uq').on(t.tokenHash)]);
