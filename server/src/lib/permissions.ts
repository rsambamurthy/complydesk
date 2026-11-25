/**
 * Fixed list of permissions; workspaces combine them into roles (same model as VendorGate).
 * Client users (a company's own people) get CLIENT_* roles and only see the clients in users.client_ids.
 */
export const PERMISSIONS = {
  'clients.view': 'View clients, their directors, shareholders and compliance calendar',
  'clients.manage': 'Add and edit clients, directors, shareholders and auditors; import from Excel',
  'compliance.work': 'Update obligations: status, SRN, filed date, assignee; add event-based filings',
  'compliance.approve': 'Review and approve filings prepared by others',
  'compliance.client_approve': 'Approve filings for the client companies the user belongs to (client users)',
  'rules.manage': 'Change compliance rules (due dates, applicability, late fees) for the workspace',
  'users.manage': 'Invite users, assign roles and clients, disable accounts',
  'tenant.settings': 'Edit workspace name and settings',
  'audit.view': 'View the audit log',
  'billing.view': 'See fees, invoices, payments and what is still to be billed',
  'team.view': 'See the team’s workload and time spent per client',
  'billing.manage': 'Set fees, raise and issue invoices, record payments, edit the firm’s billing details',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: Permission[]; client?: boolean }[] = [
  { key: 'ADMIN', name: 'Firm Admin', description: 'Full access to the workspace', permissions: ALL_PERMISSIONS.filter((p) => p !== 'compliance.client_approve') },
  { key: 'PARTNER', name: 'Partner / Reviewer', description: 'Sees all clients, reviews and approves filings', permissions: ['clients.view', 'clients.manage', 'compliance.work', 'compliance.approve', 'audit.view', 'billing.view', 'billing.manage', 'team.view'] },
  { key: 'CS_EXECUTIVE', name: 'CS Executive', description: 'Prepares filings and keeps client records up to date', permissions: ['clients.view', 'clients.manage', 'compliance.work'] },
  { key: 'CLIENT_ADMIN', name: 'Client Admin', description: 'A client company’s own user: sees its calendar and approves', permissions: ['clients.view', 'compliance.client_approve'], client: true },
  { key: 'CLIENT_VIEWER', name: 'Client Viewer', description: 'A client company’s own user: read-only', permissions: ['clients.view'], client: true },
];
