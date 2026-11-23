/**
 * Compliance rules: the built-in catalogue, with the workspace's own changes. Due dates and late fees can be
 * changed without code (the kind of rule stays); every client's calendar is recomputed on save.
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useLoad, useMeta } from '../../lib/hooks';
import { Alert, Modal, Spinner } from '../../components/ui';
import { useSession } from '../../lib/session';
import { humanize } from '../../lib/format';

interface FixedDate { month: number; day: number; yearOffset: number }
interface Rule {
  code: string; form: string; title: string; law: string | null; frequency: string; due: any; lateFee: any; notes: string | null;
  event: string | null; effectiveFrom: string | null; effectiveTo: string | null; active: boolean; overridden: boolean; builtIn: Rule;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (d: FixedDate) => `${d.day} ${MONTHS[d.month - 1]}${d.yearOffset ? ' (after FY)' : ''}`;
const ANCHOR: Record<string, string> = { AGM: 'the AGM', FIRST_BM: 'the first board meeting of the FY', INCORPORATION: 'incorporation' };

/** A rule's due date in words — the same wording on the list and in the editor. */
export function dueText(d: any): string {
  switch (d.kind) {
    case 'FIXED': return `By ${fd(d.date)}`;
    case 'AGM_LAST_DATE': return 'By 30 Sep after the FY (first AGM: 31 Dec)';
    case 'AFTER_ANCHOR': return `${d.days === 0 ? 'At' : `${d.days} days after`} ${ANCHOR[d.anchor]}${d.fallback ? ` (estimated from ${d.fallback === 'AGM_LAST_DATE' ? 'the last AGM date' : fd(d.fallback)} until known)` : ''}`;
    case 'PERIODS': return d.periods.map((p: any) => `${p.label}: ${fd(p.date)}`).join(' · ');
    case 'AFTER_EVENT': return `${d.days} days after the event`;
    case 'KYC_CYCLE': return `Every ${d.everyYears} FYs, by ${d.date.day} ${MONTHS[d.date.month - 1]}`;
    default: return '';
  }
}

export function Rules() {
  const { data, error, reload } = useLoad<Rule[]>('/admin/rules');
  const [open, setOpen] = useState<Rule>();
  const { can } = useSession();
  const flags = useMeta()?.flags ?? {};
  return (
    <div className="page">
      <div className="page-head"><div><h1>Compliance rules</h1><p className="muted">What the calendar is worked out from. Changes apply to every client straight away.</p></div></div>
      <Alert kind="warning">Built-in rules follow the Companies Act, 2013 and its rules as at November 2026 (including the 3-yearly DIR-3 KYC from 31 March 2026). Have them confirmed by a practising Company Secretary before relying on them.</Alert>
      {error && <Alert kind="error">{error}</Alert>}
      <section className="card">
        {!data ? <Spinner /> : (
          <div className="table-wrap"><table className="table compact">
            <thead><tr><th>Form</th><th>Applies to</th><th>Due</th><th>Late fee</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.code} onClick={() => can('rules.manage') && setOpen(r)} className={can('rules.manage') ? '' : 'no-hover'}>
                <td><strong>{r.form}</strong><span className="muted small block">{r.title}{r.law && ` · ${r.law}`}</span></td>
                <td className="small">{appliesText(r, flags)}</td>
                <td className="small">{dueText(r.due)}</td>
                <td className="small">{r.lateFee ? (r.lateFee.kind === 'PER_DAY' ? `₹${r.lateFee.amount}/day` : r.lateFee.note) : '—'}</td>
                <td>{!r.active ? <span className="badge">Off</span> : r.overridden ? <span className="badge badge-under_review">Changed</span> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {open && <RuleEditor rule={open} onClose={() => setOpen(undefined)} onSaved={reload} />}
    </div>
  );
}

function appliesText(r: Rule, flags: Record<string, string>) {
  const a = (r as any).applies ?? {};
  const parts: string[] = [];
  if (a.types?.length) parts.push(a.types.map((t: string) => (t === 'OPC' ? 'OPC' : 'Private')).join(', '));
  if (a.small === true) parts.push('small companies');
  if (a.small === false) parts.push('not small companies');
  if (a.flags?.length) parts.push(`only when: ${a.flags.map((f: string) => flags[f] ?? humanize(f)).join(', ')}`);
  if (a.conditions?.includes('FIRST_FY')) parts.push('first FY only');
  if (a.conditions?.includes('AUDITOR_TERM_ENDS')) parts.push('auditor term ends');
  if (r.frequency === 'EVENT') return r.event ?? 'On an event';
  if (r.frequency === 'PER_DIRECTOR') parts.push('each director');
  return parts.join(' · ') || 'All companies';
}

function DateIn({ v, on, noOffset }: { v: any; on: (x: any) => void; noOffset?: boolean }) {
  return (
    <span className="btn-row">
      <input type="number" min={1} max={31} style={{ width: 70 }} value={v.day} onChange={(e) => on({ ...v, day: Number(e.target.value) })} aria-label="Day" />
      <select value={v.month} onChange={(e) => on({ ...v, month: Number(e.target.value) })} aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
      {!noOffset && <select value={v.yearOffset} onChange={(e) => on({ ...v, yearOffset: Number(e.target.value) })} aria-label="Year"><option value={0}>in the FY</option><option value={1}>after the FY</option></select>}
    </span>
  );
}

/** Edits the numbers of a rule (days, dates, fee) — not its kind. */
function RuleEditor({ rule, onClose, onSaved }: { rule: Rule; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<Rule>(structuredClone(rule));
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const due = r.due;
  const setDue = (p: any) => setR({ ...r, due: { ...due, ...p } });
  async function save(revert = false) {
    setBusy(true); setErr(undefined);
    try {
      if (revert) await api(`/admin/rules/${r.code}`, { method: 'DELETE' });
      else await api(`/admin/rules/${r.code}`, { method: 'PUT', body: { title: r.title, active: r.active, notes: r.notes, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, due: r.due, lateFee: r.lateFee } });
      onSaved(); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal title={`${rule.form} — ${rule.title}`} wide onClose={onClose} footer={<>
      {rule.overridden && <button className="btn btn-danger-ghost" style={{ marginInlineEnd: 'auto' }} disabled={busy} onClick={() => save(true)}>Back to built-in</button>}
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={() => save()}>Save and recompute</button>
    </>}>
      {err && <Alert kind="error">{err}</Alert>}
      <p className="muted small" style={{ marginTop: 0 }}>Built-in: {dueText(rule.builtIn.due)}</p>
      <div className="stack">
        <label className="check-item"><input type="checkbox" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} /><span><strong>Use this rule</strong></span></label>
        {due.kind === 'FIXED' && <div className="field"><label>Due by</label><DateIn v={due.date} on={(date) => setDue({ date })} /></div>}
        {(due.kind === 'AFTER_ANCHOR' || due.kind === 'AFTER_EVENT') && <div className="field"><label>Days after {due.kind === 'AFTER_EVENT' ? 'the event' : ANCHOR[due.anchor]}</label><input type="number" min={0} value={due.days} onChange={(e) => setDue({ days: Number(e.target.value) })} style={{ width: 120 }} /></div>}
        {due.kind === 'PERIODS' && due.periods.map((p: any, i: number) => (
          <div key={i} className="field"><label>{p.label}</label><DateIn v={p.date} on={(date) => setDue({ periods: due.periods.map((x: any, j: number) => (j === i ? { ...x, date } : x)) })} /></div>
        ))}
        {due.kind === 'KYC_CYCLE' && <>
          <div className="field"><label>Every how many FYs</label><input type="number" min={1} value={due.everyYears} onChange={(e) => setDue({ everyYears: Number(e.target.value) })} style={{ width: 120 }} /></div>
          <div className="field"><label>Due by</label><DateIn v={due.date} noOffset on={(date) => setDue({ date })} /></div>
        </>}
        {r.lateFee?.kind === 'PER_DAY' && <div className="field"><label>Additional fee per day (₹)</label><input type="number" min={0} value={r.lateFee.amount} onChange={(e) => setR({ ...r, lateFee: { ...r.lateFee, amount: Number(e.target.value) } })} style={{ width: 120 }} /></div>}
        <div className="field-grid">
          <div className="field"><label>In force from</label><input type="date" value={r.effectiveFrom ?? ''} onChange={(e) => setR({ ...r, effectiveFrom: e.target.value || null })} /></div>
          <div className="field"><label>In force until</label><input type="date" value={r.effectiveTo ?? ''} onChange={(e) => setR({ ...r, effectiveTo: e.target.value || null })} /></div>
        </div>
        <div className="field"><label>Notes</label><textarea rows={3} value={r.notes ?? ''} onChange={(e) => setR({ ...r, notes: e.target.value })} /></div>
      </div>
    </Modal>
  );
}
