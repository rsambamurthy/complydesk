/** Field lists for the client master — one definition for "add" and "edit" of each record. */
import type { FieldDef } from './RecordForm';
import type { Meta } from '../lib/types';
import { COMPANY_TYPE, DESIGNATION } from '../lib/format';

export const clientFields = (meta: Meta): FieldDef[] => [
  { key: 'name', label: 'Company name', required: true, wide: true },
  { key: 'cin', label: 'CIN', required: true, placeholder: 'U72900TN2015PTC123456' },
  { key: 'companyType', label: 'Type', type: 'select', required: true, options: Object.entries(COMPANY_TYPE).map(([value, label]) => ({ value, label })) },
  { key: 'incorporationDate', label: 'Incorporation date', type: 'date', help: 'Sets the first FY, first AGM (9 months) and INC-20A.' },
  { key: 'rocOffice', label: 'RoC', placeholder: 'RoC Chennai' },
  { key: 'authorisedCapital', label: 'Authorised capital (₹)', type: 'number' },
  { key: 'paidUpCapital', label: 'Paid-up capital (₹)', type: 'number' },
  { key: 'email', label: 'Company email', type: 'email' },
  { key: 'ownerId', label: 'Handled by', type: 'select', options: meta.staff.map((s) => ({ value: s.id, label: s.name })) },
  { key: 'registeredOffice', label: 'Registered office', type: 'textarea', wide: true },
  { key: 'smallCompany', label: 'Small company (Sec 2(85))', type: 'checkbox', wide: true, help: 'Two board meetings a year and MGT-7A instead of four meetings and MGT-7.' },
  ...Object.entries(meta.flags).map(([k, label]) => ({ key: `flag.${k}`, label, type: 'checkbox' as const, wide: true })),
];

/** Client values ↔ form values (flags are separate tick boxes on the form). */
export const clientToForm = (c: Record<string, any>) => ({ ...c, ...Object.fromEntries(Object.entries(c.flags ?? {}).map(([k, v]) => [`flag.${k}`, v])) });
export const formToClient = (v: Record<string, any>) => {
  const flags: Record<string, boolean> = {};
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(v)) if (k.startsWith('flag.')) flags[k.slice(5)] = !!val; else out[k] = val;
  for (const k of ['id', 'tenantId', 'status', 'createdAt', 'ownerName', 'overdue', 'due30', 'nextDue']) delete out[k];
  return { ...out, flags };
};

export const personFields = (meta: Meta): FieldDef[] => [
  { key: 'name', label: 'Name', required: true },
  { key: 'designation', label: 'Designation', type: 'select', required: true, options: meta.designations.map((d) => ({ value: d, label: DESIGNATION[d] ?? d })) },
  { key: 'din', label: 'DIN', placeholder: '8 digits', show: (v) => String(v.designation ?? '').includes('DIRECTOR') },
  { key: 'pan', label: 'PAN' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'appointedOn', label: 'Appointed on', type: 'date' },
  { key: 'ceasedOn', label: 'Ceased on', type: 'date', help: 'Leave empty while in office.' },
  { key: 'dscExpiry', label: 'DSC expiry', type: 'date' },
  { key: 'dinAllottedOn', label: 'DIN allotted on', type: 'date', show: (v) => String(v.designation ?? '').includes('DIRECTOR') },
  { key: 'kycLastFiledFy', label: 'Last DIR-3 KYC filed in FY', type: 'number', placeholder: 'e.g. 2025 for FY 2025-26', show: (v) => String(v.designation ?? '').includes('DIRECTOR'), help: 'KYC is due every 3 FYs (by 30 June), counted from this year or the DIN allotment.' },
];

export const shareholderFields: FieldDef[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'pan', label: 'PAN' },
  { key: 'folio', label: 'Folio' },
  { key: 'shareClass', label: 'Class', type: 'select', required: true, options: [{ value: 'EQUITY', label: 'Equity' }, { value: 'PREFERENCE', label: 'Preference' }] },
  { key: 'shares', label: 'Number of shares', type: 'number', required: true },
  { key: 'faceValue', label: 'Face value (₹)', type: 'number' },
];

export const auditorFields: FieldDef[] = [
  { key: 'firmName', label: 'Audit firm', required: true, wide: true },
  { key: 'frn', label: 'Firm registration no.' },
  { key: 'appointedOn', label: 'Appointed on', type: 'date' },
  { key: 'termFromFy', label: 'Term: first FY', type: 'number', placeholder: 'e.g. 2021' },
  { key: 'termToFy', label: 'Term: last FY', type: 'number', placeholder: 'e.g. 2025', help: 'ADT-1 is put on the calendar for the AGM of this FY.' },
  { key: 'current', label: 'Current auditor', type: 'checkbox' },
];
