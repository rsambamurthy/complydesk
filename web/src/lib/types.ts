export type Permission = 'clients.view' | 'clients.manage' | 'compliance.work' | 'compliance.approve' | 'compliance.client_approve' | 'rules.manage' | 'users.manage' | 'tenant.settings' | 'audit.view' | 'billing.view' | 'billing.manage' | 'team.view';

export interface Me {
  tenant: { id: string; name: string; slug: string };
  user: { id: string; name: string; email: string; clientIds: string[] };
  roles: { id: string; key: string; name: string }[];
  permissions: Permission[];
  access: Access;
  platformAdmin: boolean;
  emailVerified: boolean;
}

export type Access =
  | { ok: true; state: 'ACTIVE' }
  | { ok: true; state: 'TRIAL'; daysLeft: number; clientLimit: number | null }
  | { ok: false; state: 'TRIAL_ENDED' | 'PAYMENT_DUE' | 'SUSPENDED' | 'PENDING_APPROVAL'; message: string };

export type ObStatus = 'OPEN' | 'IN_PROGRESS' | 'FILED' | 'NOT_APPLICABLE';

export interface Client {
  id: string; cin: string; name: string; companyType: 'PRIVATE' | 'OPC'; smallCompany: boolean;
  incorporationDate: string | null; rocOffice: string | null; registeredOffice: string | null; email: string | null;
  authorisedCapital: string | null; paidUpCapital: string | null; flags: Record<string, boolean>;
  ownerId: string | null; status: string;
  ownerName?: string | null; overdue?: number; due30?: number; nextDue?: string | null;
}
export interface Person {
  id: string; clientId: string; name: string; din: string | null; pan: string | null; email: string | null; designation: string;
  appointedOn: string | null; ceasedOn: string | null; dscExpiry: string | null; dinAllottedOn: string | null; kycLastFiledFy: number | null;
}
export interface Shareholder { id: string; name: string; pan: string | null; folio: string | null; shareClass: string; shares: number; faceValue: string }
export interface Auditor { id: string; firmName: string; frn: string | null; appointedOn: string | null; termFromFy: number | null; termToFy: number | null; current: boolean }
export interface Year { fy: number; agmDate: string | null; firstBoardMeetingDate: string | null }

export interface Obligation {
  id: string; clientId: string; clientName: string; cin: string; ruleCode: string; form: string; title: string; fy: number;
  periodLabel: string; personId: string | null; personName: string | null; eventDate: string | null; dueDate: string; provisional: boolean;
  status: ObStatus; source: 'AUTO' | 'MANUAL'; filedOn: string | null; srn: string | null; assigneeId: string | null; assigneeName: string | null;
  notes: string | null; lateFee: number | null; lateFeeNote: string | null; law: string | null; ruleNotes: string | null;
  stage: string; preparedById: string | null;
}
export interface Summary { overdue: number; week: number; month: number; open: number; done: number; review: number; client: number }

export interface Meta {
  flags: Record<string, string>; designations: string[]; fys: number[];
  eventRules: { code: string; form: string; title: string; event: string | null; days: number }[];
  staff: { id: string; name: string }[];
}
