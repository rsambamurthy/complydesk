/**
 * Compliance rules: wording (dueText / appliesText), the full rule editor and the rule history — one set of
 * components for the firm's Compliance rules page and Integrata's platform rules page.
 */
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { Alert, Modal, Spinner } from './ui';
import { TabStrip } from './TabStrip';

export interface FixedDate { month: number; day: number; yearOffset: number }
export interface Rule {
  code: string; form: string; title: string; law: string | null; frequency: string; applies: Applies; due: any; lateFee: any;
  event: string | null; notes: string | null; effectiveFrom: string | null; effectiveTo: string | null; active: boolean;
  source?: string; updatedBy?: string | null; updatedAt?: string;
}
interface Applies { types?: string[]; small?: boolean; flags?: string[]; notFlags?: string[]; conditions?: string[] }

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (d: FixedDate) => `${d.day} ${MONTHS[d.month - 1]}${d.yearOffset ? ' (after FY)' : ''}`;
const ANCHOR: Record<string, string> = { AGM: 'the AGM', FIRST_BM: 'the first board meeting of the FY', INCORPORATION: 'incorporation' };
const CONDITION: Record<string, string> = { FIRST_FY: 'first financial year only', AUDITOR_TERM_ENDS: 'when the auditor’s term ends that year' };
const TYPE: Record<string, string> = { PRIVATE: 'Private', OPC: 'OPC' };

/** A rule's due date in words — the same wording everywhere. */
export function dueText(d: any): string {
  switch (d?.kind) {
    case 'FIXED': return `By ${fd(d.date)}`;
    case 'AGM_LAST_DATE': return 'By 30 Sep after the FY (first AGM: 31 Dec)';
    case 'AFTER_ANCHOR': return `${d.days === 0 ? 'At' : `${d.days} days after`} ${ANCHOR[d.anchor]}${d.fallback ? ` (estimated from ${d.fallback === 'AGM_LAST_DATE' ? 'the last AGM date' : fd(d.fallback)} until known)` : ''}`;
    case 'PERIODS': return d.periods.map((p: any) => `${p.label}: ${fd(p.date)}`).join(' · ');
    case 'AFTER_EVENT': return `${d.days} days after the event`;
    case 'KYC_CYCLE': return `Every ${d.everyYears} FYs, by ${d.date.day} ${MONTHS[d.date.month - 1]}`;
    default: return '';
  }
}

export function appliesText(r: Pick<Rule, 'applies' | 'frequency' | 'event'>, flags: Record<string, string>) {
  const a = r.applies ?? {};
  if (r.frequency === 'EVENT') return r.event ?? 'On an event';
  const parts: string[] = [];
  if (a.types?.length) parts.push(a.types.map((t) => TYPE[t] ?? t).join(', '));
  if (a.small === true) parts.push('small companies');
  if (a.small === false) parts.push('not small companies');
  if (a.flags?.length) parts.push(`only when: ${a.flags.map((f) => flags[f] ?? f).join(', ')}`);
  if (a.notFlags?.length) parts.push(`not when: ${a.notFlags.map((f) => flags[f] ?? f).join(', ')}`);
  for (const c of a.conditions ?? []) parts.push(CONDITION[c] ?? c);
  if (r.frequency === 'PER_DIRECTOR') parts.push('each director');
  return parts.join(' · ') || 'All companies';
}

export const feeText = (f: any) => (!f ? '—' : f.kind === 'PER_DAY' ? `₹${f.amount}/day` : f.note);

const DUE_KINDS: { kind: string; label: string; make: () => any }[] = [
  { kind: 'AFTER_ANCHOR', label: 'Days after the AGM / first board meeting / incorporation', make: () => ({ kind: 'AFTER_ANCHOR', anchor: 'AGM', days: 30, fallback: 'AGM_LAST_DATE' }) },
  { kind: 'FIXED', label: 'A fixed date each year', make: () => ({ kind: 'FIXED', date: { day: 30, month: 6, yearOffset: 1 } }) },
  { kind: 'PERIODS', label: 'Several dates in the year (quarters, half-years…)', make: () => ({ kind: 'PERIODS', periods: [{ label: 'H1 (Apr–Sep)', date: { day: 31, month: 10, yearOffset: 0 } }, { label: 'H2 (Oct–Mar)', date: { day: 30, month: 4, yearOffset: 1 } }] }) },
  { kind: 'AFTER_EVENT', label: 'Days after an event (appointment, allotment, charge…)', make: () => ({ kind: 'AFTER_EVENT', days: 30 }) },
  { kind: 'AGM_LAST_DATE', label: 'The last date for the AGM', make: () => ({ kind: 'AGM_LAST_DATE' }) },
  { kind: 'KYC_CYCLE', label: 'Each director, every few years', make: () => ({ kind: 'KYC_CYCLE', everyYears: 3, date: { day: 30, month: 6 } }) },
];

function DateIn({ v, on, noOffset }: { v: any; on: (x: any) => void; noOffset?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
      <input type="number" min={1} max={31} style={{ width: 70 }} value={v.day} onChange={(e) => on({ ...v, day: Number(e.target.value) })} aria-label="Day" />
      <select style={{ width: 90 }} value={v.month} onChange={(e) => on({ ...v, month: Number(e.target.value) })} aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
      {!noOffset && <select style={{ width: 150 }} value={v.yearOffset} onChange={(e) => on({ ...v, yearOffset: Number(e.target.value) })} aria-label="Year"><option value={0}>in the FY</option><option value={1}>after the FY</option></select>}
    </span>
  );
}
const Check = ({ checked, on, label }: { checked: boolean; on: (v: boolean) => void; label: string }) =>
  <label className="check-item"><input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} /><span>{label}</span></label>;
const toggle = (list: string[] | undefined, v: string, on: boolean) => (on ? [...(list ?? []), v] : (list ?? []).filter((x) => x !== v));

const BLANK: Rule = { code: '', form: '', title: '', law: null, frequency: 'ANNUAL', applies: {}, due: DUE_KINDS[0].make(), lateFee: null, event: null, notes: null, effectiveFrom: null, effectiveTo: null, active: true };

/**
 * The full editor. `base` is the rule this one starts from (shown for comparison); `onReset` undoes the change.
 * Endpoints differ by caller: `/admin/rules` for a firm, `/platform/rules` for Integrata.
 */
export function RuleEditor({ rule, endpoint, flags, isNew, base, resetLabel, readOnly, note, onClose, onSaved }: {
  rule?: Rule; endpoint: string; flags: Record<string, string>; isNew?: boolean; base?: Rule | null; resetLabel?: string; readOnly?: boolean; note?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [r, setR] = useState<Rule>(structuredClone(rule ?? BLANK));
  const [tab, setTab] = useState<'rule' | 'history'>('rule');
  const [err, setErr] = useState<{ msg: string; details?: Record<string, string> }>();
  const [busy, setBusy] = useState(false);
  const due = r.due;
  const setDue = (p: any) => setR({ ...r, due: { ...due, ...p } });
  const setA = (p: Partial<Applies>) => setR({ ...r, applies: { ...r.applies, ...p } });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(undefined);
    try { await fn(); onSaved(); onClose(); } catch (e: any) { setErr({ msg: e.message, details: e instanceof ApiError ? e.details : undefined }); setBusy(false); }
  }
  const body = () => ({ ...(isNew ? { code: r.code } : {}), form: r.form, title: r.title, law: r.law, applies: r.applies, due: r.due, lateFee: r.lateFee, event: r.event, notes: r.notes, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, active: r.active });
  const save = () => run(() => api(isNew ? endpoint : `${endpoint}/${r.code}`, { method: isNew ? 'POST' : 'PUT', body: body() }));
  const reset = () => run(() => api(`${endpoint}/${r.code}`, { method: 'DELETE' }));

  return (
    <Modal title={isNew ? 'New compliance rule' : `${rule!.form} — ${rule!.title}`} wide onClose={onClose} footer={<>
      {onResetVisible(resetLabel, isNew, readOnly) && <button className="btn btn-danger-ghost" style={{ marginInlineEnd: 'auto' }} disabled={busy} onClick={() => window.confirm(`${resetLabel}?`) && reset()}>{resetLabel}</button>}
      <button className="btn btn-secondary" onClick={onClose}>{readOnly || tab === 'history' ? 'Close' : 'Cancel'}</button>
      {!readOnly && tab === 'rule' && <button className="btn btn-primary" disabled={busy} onClick={save}>{isNew ? 'Add rule and recompute' : 'Save and recompute'}</button>}
    </>}>
      {!isNew && <TabStrip>{(['rule', 'history'] as const).map((t) => <button key={t} role="tab" className={tab === t ? 'active' : ''} aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'rule' ? 'Rule' : 'History'}</button>)}</TabStrip>}
      {tab === 'history' ? <RuleHistory endpoint={`${endpoint}/${rule!.code}/history`} /> : (
        <fieldset disabled={readOnly || busy} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          {note && <Alert kind="info">{note}</Alert>}
          {err && <Alert kind="error">{err.msg}{err.details && <ul style={{ margin: '6px 0 0' }}>{Object.entries(err.details).map(([k, m]) => <li key={k}><span className="mono small">{k}</span>: {m}</li>)}</ul>}</Alert>}
          <p className="muted small" style={{ margin: 0 }}><strong>Due:</strong> {dueText(r.due)} · <strong>Applies to:</strong> {appliesText(r, flags)}{base && <><br />Built-in: {dueText(base.due)} · {appliesText(base, flags)}</>}</p>

          <h4 style={{ margin: '6px 0 0' }}>What it is</h4>
          <div className="field-grid">
            {isNew && <div className="field"><label>Code</label><input className="mono" value={r.code} onChange={(e) => setR({ ...r, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} placeholder="e.g. BEN2" /><span className="field-help">Capital letters, digits and _. Can’t be changed later.</span></div>}
            <div className="field"><label>Form or meeting</label><input value={r.form} onChange={(e) => setR({ ...r, form: e.target.value })} placeholder="e.g. BEN-2" /></div>
            <div className="field field-wide"><label>Description</label><input value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} placeholder="e.g. Return of significant beneficial owners" /></div>
            <div className="field field-wide"><label>Law / section</label><input value={r.law ?? ''} onChange={(e) => setR({ ...r, law: e.target.value })} placeholder="e.g. Sec 90" /></div>
          </div>

          <h4 style={{ margin: '6px 0 0' }}>When it’s due</h4>
          <div className="field"><label>Kind of due date</label>
            <select value={due.kind} onChange={(e) => setR({ ...r, due: DUE_KINDS.find((k) => k.kind === e.target.value)!.make() })}>{DUE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></div>
          {due.kind === 'FIXED' && <div className="field"><label>Due by</label><DateIn v={due.date} on={(date) => setDue({ date })} /></div>}
          {due.kind === 'AFTER_ANCHOR' && <div className="field-grid">
            <div className="field"><label>Counted from</label><select value={due.anchor} onChange={(e) => setDue({ anchor: e.target.value })}>{Object.entries(ANCHOR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field"><label>Days after</label><input type="number" min={0} value={due.days} onChange={(e) => setDue({ days: Number(e.target.value) })} /></div>
            {due.anchor !== 'INCORPORATION' && <div className="field field-wide"><label>Until that date is known, estimate from</label>
              <span className="btn-row">
                <select value={!due.fallback ? '' : due.fallback === 'AGM_LAST_DATE' ? 'AGM' : 'DATE'} onChange={(e) => setDue({ fallback: e.target.value === 'AGM' ? 'AGM_LAST_DATE' : e.target.value === 'DATE' ? { day: 30, month: 6, yearOffset: 0 } : undefined })}>
                  <option value="">Don’t estimate (show nothing until known)</option><option value="AGM">The last date for the AGM</option><option value="DATE">A fixed date</option></select>
                {due.fallback && due.fallback !== 'AGM_LAST_DATE' && <DateIn v={due.fallback} on={(fallback) => setDue({ fallback })} />}
              </span></div>}
          </div>}
          {due.kind === 'PERIODS' && <div className="stack">
            {due.periods.map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={p.label} onChange={(e) => setDue({ periods: due.periods.map((x: any, j: number) => (j === i ? { ...x, label: e.target.value } : x)) })} style={{ width: 180 }} aria-label="Period name" />
                <DateIn v={p.date} on={(date) => setDue({ periods: due.periods.map((x: any, j: number) => (j === i ? { ...x, date } : x)) })} />
                {due.periods.length > 1 && <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => setDue({ periods: due.periods.filter((_: any, j: number) => j !== i) })}>Remove</button>}
              </div>
            ))}
            <div><button type="button" className="btn btn-sm btn-secondary" onClick={() => setDue({ periods: [...due.periods, { label: `Period ${due.periods.length + 1}`, date: { day: 31, month: 3, yearOffset: 1 } }] })}>Add a date</button></div>
          </div>}
          {due.kind === 'AFTER_EVENT' && <div className="field-grid">
            <div className="field"><label>Days after the event</label><input type="number" min={0} value={due.days} onChange={(e) => setDue({ days: Number(e.target.value) })} /></div>
            <div className="field"><label>The event</label><input value={r.event ?? ''} onChange={(e) => setR({ ...r, event: e.target.value })} placeholder="e.g. Change in beneficial ownership" /></div>
          </div>}
          {due.kind === 'KYC_CYCLE' && <div className="field-grid">
            <div className="field"><label>Every how many FYs</label><input type="number" min={1} value={due.everyYears} onChange={(e) => setDue({ everyYears: Number(e.target.value) })} /></div>
            <div className="field"><label>Due by</label><DateIn v={due.date} noOffset on={(date) => setDue({ date })} /></div>
          </div>}

          {due.kind !== 'AFTER_EVENT' && <>
            <h4 style={{ margin: '6px 0 0' }}>Which companies</h4>
            <div className="field-grid">
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend>Company type (none ticked = all)</legend>
                {Object.entries(TYPE).map(([k, l]) => <Check key={k} label={l} checked={!!r.applies.types?.includes(k)} on={(v) => setA({ types: toggle(r.applies.types, k, v) })} />)}</fieldset>
              <div className="field"><label>Small company</label>
                <select value={r.applies.small === undefined ? '' : r.applies.small ? 'yes' : 'no'} onChange={(e) => setA({ small: e.target.value === '' ? undefined : e.target.value === 'yes' })}>
                  <option value="">Any</option><option value="yes">Small companies only</option><option value="no">Not small companies</option></select></div>
              <fieldset className="field field-wide" style={{ border: 0, padding: 0, margin: 0 }}><legend>Only when the client has</legend>
                {Object.entries(flags).map(([k, l]) => <Check key={k} label={l} checked={!!r.applies.flags?.includes(k)} on={(v) => setA({ flags: toggle(r.applies.flags, k, v) })} />)}
                {Object.entries(CONDITION).map(([k, l]) => <Check key={k} label={l[0].toUpperCase() + l.slice(1)} checked={!!r.applies.conditions?.includes(k)} on={(v) => setA({ conditions: toggle(r.applies.conditions, k, v) })} />)}
              </fieldset>
              <fieldset className="field field-wide" style={{ border: 0, padding: 0, margin: 0 }}><legend>Not when the client has</legend>
                {Object.entries(flags).map(([k, l]) => <Check key={k} label={l} checked={!!r.applies.notFlags?.includes(k)} on={(v) => setA({ notFlags: toggle(r.applies.notFlags, k, v) })} />)}
              </fieldset>
            </div>
          </>}

          <h4 style={{ margin: '6px 0 0' }}>Late fee and dates in force</h4>
          <div className="field-grid">
            <div className="field"><label>Late fee</label>
              <select value={r.lateFee?.kind ?? ''} onChange={(e) => setR({ ...r, lateFee: e.target.value === 'PER_DAY' ? { kind: 'PER_DAY', amount: 100 } : e.target.value === 'NOTE' ? { kind: 'NOTE', note: '' } : null })}>
                <option value="">None shown</option><option value="PER_DAY">An amount per day</option><option value="NOTE">A note (e.g. 2×–12× the normal fee)</option></select></div>
            {r.lateFee?.kind === 'PER_DAY' && <div className="field"><label>₹ per day</label><input type="number" min={0} value={r.lateFee.amount} onChange={(e) => setR({ ...r, lateFee: { ...r.lateFee, amount: Number(e.target.value) } })} /></div>}
            {r.lateFee?.kind === 'NOTE' && <div className="field"><label>Note</label><input value={r.lateFee.note} onChange={(e) => setR({ ...r, lateFee: { ...r.lateFee, note: e.target.value } })} /></div>}
            <div className="field"><label>In force from</label><input type="date" value={r.effectiveFrom ?? ''} onChange={(e) => setR({ ...r, effectiveFrom: e.target.value || null })} /><span className="field-help">Due dates before this are ignored.</span></div>
            <div className="field"><label>In force until</label><input type="date" value={r.effectiveTo ?? ''} onChange={(e) => setR({ ...r, effectiveTo: e.target.value || null })} /><span className="field-help">For a rule that a change in law replaces.</span></div>
            <div className="field field-wide"><label>Notes</label><textarea rows={3} value={r.notes ?? ''} onChange={(e) => setR({ ...r, notes: e.target.value })} /></div>
          </div>
          <Check label="Use this rule" checked={r.active} on={(active) => setR({ ...r, active })} />
        </fieldset>
      )}
    </Modal>
  );
}
const onResetVisible = (label?: string, isNew?: boolean, readOnly?: boolean) => !!label && !isNew && !readOnly;

const ACTION: Record<string, string> = { create: 'Added', update: 'Changed', revert: 'Undone', delete: 'Removed' };
const FIELD: Record<string, string> = { form: 'Form', title: 'Description', law: 'Law', applies: 'Applies to', due: 'Due date', lateFee: 'Late fee', event: 'Event', notes: 'Notes', effectiveFrom: 'In force from', effectiveTo: 'In force until', active: 'In use', source: 'Source' };

/** Who changed the rule, when, and what changed (Integrata's changes and the firm's own). */
function RuleHistory({ endpoint }: { endpoint: string }) {
  const { data, error } = useLoad<{ id: string; tenantId: string | null; action: string; by: string | null; before: any; after: any; at: string }[]>(endpoint);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;
  if (!data.length) return <p className="muted pad">No changes yet — the rule is as shipped.</p>;
  const show = (k: string, v: any) => (v === null || v === undefined || v === '' ? '—' : k === 'due' ? dueText(v) : k === 'lateFee' ? feeText(v) : k === 'applies' ? JSON.stringify(v) : String(v));
  return (
    <table className="table compact static"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Changes</th></tr></thead><tbody>
      {data.map((h) => {
        const keys = Object.keys(FIELD).filter((k) => k !== 'source' && JSON.stringify(h.before?.[k] ?? null) !== JSON.stringify(h.after?.[k] ?? null));
        return <tr key={h.id}>
          <td className="small nowrap">{fmtDateTime(h.at)}</td>
          <td className="small">{h.by ?? '—'}<span className="muted block">{h.tenantId ? 'Your firm' : 'Integrata'}</span></td>
          <td className="small">{ACTION[h.action] ?? h.action}</td>
          <td className="small">{h.action === 'create' && !h.before ? 'New rule' : keys.length === 0 ? '—' : keys.map((k) => <div key={k}><strong>{FIELD[k]}:</strong> {show(k, h.before?.[k])} → {show(k, h.after?.[k])}</div>)}</td>
        </tr>;
      })}
    </tbody></table>
  );
}
