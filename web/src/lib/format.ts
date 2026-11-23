/** Formatting and labels shared by every screen (one place, never re-typed). */
import type { ObStatus } from './types';

export const loc = () => 'en-IN';
export const fmtDate = (s?: string | null) => (!s ? '—' : new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
export const fmtDateTime = (s?: string | null) => (!s ? '—' : new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }));
export const money = (v?: string | number | null) => (v === null || v === undefined || v === '' ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v)));
export const num = (n: number) => n.toLocaleString('en-IN');
export const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
export const today = () => new Date().toISOString().slice(0, 10);
export const daysFrom = (d: string) => Math.round((new Date(`${d}T00:00:00Z`).getTime() - new Date(`${today()}T00:00:00Z`).getTime()) / 86_400_000);
export const humanize = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const STATUS_LABEL: Record<ObStatus, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', FILED: 'Done', NOT_APPLICABLE: 'Not applicable' };
export const isDone = (s: ObStatus) => s === 'FILED' || s === 'NOT_APPLICABLE';
/** Meetings are "held", forms are "filed". */
export const isMeeting = (form: string) => form === 'AGM' || form === 'Board meeting';
export const doneWord = (form: string) => (isMeeting(form) ? 'Held' : 'Filed');

export const COMPANY_TYPE: Record<string, string> = { PRIVATE: 'Private limited', OPC: 'One Person Company' };
export const DESIGNATION: Record<string, string> = {
  DIRECTOR: 'Director', MANAGING_DIRECTOR: 'Managing Director', WHOLE_TIME_DIRECTOR: 'Whole-time Director', NOMINEE_DIRECTOR: 'Nominee Director',
  INDEPENDENT_DIRECTOR: 'Independent Director', CEO: 'CEO', CFO: 'CFO', CS: 'Company Secretary',
};

export function monogram(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const caps = name.match(/[A-Z]/g);
  return (caps && caps.length > 1 ? caps[0] + caps[1] : name.slice(0, 2)).toUpperCase();
}
