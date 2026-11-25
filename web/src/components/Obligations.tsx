/**
 * Obligations, shared by the dashboard, the compliance calendar and a client's Compliance tab:
 * the table, the update dialog (status, held/filed date, SRN, assignee) and the "Add event-based filing" dialog.
 */
import { TimeLog } from './TimeLog';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Meta, Obligation, Person } from '../lib/types';
import { doneWord, fmtDate, fmtDateTime, fyLabel, isMeeting, money, STAGE, today } from '../lib/format';
import { Attachments } from './Attachments';
import { ReadDocument, useReading } from './DocumentReader';
import { ReviewCheck } from './ReviewCheck';
import { useLoad } from '../lib/hooks';
import { Alert, Modal, Spinner } from './ui';
import { DueDate, Empty, StatusBadge } from './ui';
import { RecordModal, type FieldDef } from './RecordForm';
import { useSession } from '../lib/session';

export function ObligationTable({ rows, showClient = true, onChanged, meta, empty = 'Nothing here.' }: {
  rows: Obligation[]; showClient?: boolean; onChanged: () => void; meta?: Meta; empty?: string;
}) {
  const [open, setOpen] = useState<Obligation>();
  const { can } = useSession();
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead><tr>
          <th>Due</th>{showClient && <th>Client</th>}<th>Filing / meeting</th><th>Period</th><th>Status</th><th>With</th><th className="num">Late fee</th>
        </tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} onClick={() => (can('compliance.work') || !isMeeting(o.form)) && setOpen(o)} className={can('compliance.work') || !isMeeting(o.form) ? '' : 'no-hover'}>
              <td><DueDate date={o.dueDate} status={o.status} provisional={o.provisional} /></td>
              {showClient && <td><Link to={`/clients/${o.clientId}`} onClick={(e) => e.stopPropagation()}>{o.clientName}</Link><span className="muted small block mono">{o.cin}</span></td>}
              <td><strong>{o.form}</strong><span className="muted small block">{o.title}</span></td>
              <td className="small">{fyLabel(o.fy)}{o.periodLabel && <span className="block muted">{o.periodLabel}</span>}</td>
              <td>{isMeeting(o.form) ? <StatusBadge status={o.status} /> : <span className={`badge ${STAGE[o.stage]?.[1] ?? ''}`}>{STAGE[o.stage]?.[0] ?? o.stage}</span>}{o.status === 'FILED' && <span className="small muted block">{doneWord(o.form)} {fmtDate(o.filedOn)}{o.srn && ` · ${o.srn}`}</span>}</td>
              <td className="small">{o.assigneeName ?? <span className="muted">—</span>}</td>
              <td className="num small">{o.lateFee ? <span className="overdue">{money(o.lateFee)}</span> : o.lateFeeNote && o.status !== 'FILED' && o.dueDate < today() ? <span className="warn-text" title={o.lateFeeNote}>Fee applies</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <ObligationModal o={open} meta={meta} onClose={() => setOpen(undefined)} onSaved={onChanged} />}
    </div>
  );
}

/** A filing opens the workflow dialog; a meeting item (board meeting / AGM) keeps the simple held/not-held form. */
export function ObligationModal(props: { o: Obligation; meta?: Meta; onClose: () => void; onSaved: () => void }) {
  return isMeeting(props.o.form) ? <MeetingItemModal {...props} /> : <FilingModal {...props} />;
}

function MeetingItemModal({ o, meta, onClose, onSaved }: { o: Obligation; meta?: Meta; onClose: () => void; onSaved: () => void }) {
  const meeting = true;
  const fields: FieldDef[] = [
    { key: 'status', label: 'Status', type: 'select', required: true, options: [
      { value: 'OPEN', label: 'Open' }, { value: 'IN_PROGRESS', label: 'In progress' },
      { value: 'FILED', label: meeting ? 'Held' : 'Filed' }, { value: 'NOT_APPLICABLE', label: 'Not applicable' },
    ] },
    { key: 'filedOn', label: meeting ? 'Held on' : 'Filed on', type: 'date', show: (v) => v.status === 'FILED', required: true,
      help: o.ruleCode === 'AGM' ? 'AOC-4, MGT-7 and ADT-1 due dates follow this date.' : meeting ? 'The first meeting of the year sets the MBP-1 / DIR-8 date.' : undefined },
    { key: 'srn', label: 'SRN', show: (v) => v.status === 'FILED' && !meeting, placeholder: 'e.g. AB1234567' },
    { key: 'assigneeId', label: 'Assigned to', type: 'select', options: (meta?.staff ?? []).map((s) => ({ value: s.id, label: s.name })) },
    ...(o.source === 'MANUAL' ? [{ key: 'dueDate', label: 'Due date', type: 'date' as const, help: 'Event-based: change it if a different period applies (e.g. 15 days for a private placement).' }] : []),
    { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ];
  return (
    <RecordModal
      title={`${o.form} — ${o.clientName}`}
      fields={fields}
      initial={{ status: o.status, filedOn: o.filedOn ?? today(), srn: o.srn ?? '', assigneeId: o.assigneeId, notes: o.notes ?? '', dueDate: o.dueDate }}
      extra={<p className="muted small" style={{ marginTop: 0 }}>
        {o.title}{o.periodLabel && ` · ${o.periodLabel}`} · {fyLabel(o.fy)} · due {fmtDate(o.dueDate)}{o.provisional && ' (estimated)'}{o.law && ` · ${o.law}`}
        {o.ruleNotes && <span className="block">{o.ruleNotes}</span>}
        {o.lateFeeNote && <span className="block">{o.lateFeeNote}</span>}
      </p>}
      onSave={async (v) => { await api(`/obligations/${o.id}`, { method: 'PATCH', body: { ...v, filedOn: v.status === 'FILED' ? v.filedOn : null } }); onSaved(); }}
      danger={o.source === 'MANUAL' ? { label: 'Remove', onClick: async () => { await api(`/obligations/${o.id}`, { method: 'DELETE' }); onSaved(); } } : undefined}
      onClose={onClose}
    />
  );
}

export function EventModal({ clientId, meta, people, onClose, onSaved }: { clientId: string; meta: Meta; people: Person[]; onClose: () => void; onSaved: () => void }) {
  return (
    <RecordModal
      title="Add an event-based filing"
      saveLabel="Add to calendar"
      fields={[
        { key: 'ruleCode', label: 'Filing', type: 'select', required: true, wide: true, options: meta.eventRules.map((r) => ({ value: r.code, label: `${r.form} — ${r.event ?? r.title} (${r.days} days)` })) },
        { key: 'eventDate', label: 'Date of the event', type: 'date', required: true, help: 'Board / general meeting date, allotment date, charge date…' },
        { key: 'label', label: 'What happened', required: true, placeholder: 'e.g. Appointment of Ms. Divya Menon as director' },
        { key: 'personId', label: 'Director / KMP (if about a person)', type: 'select', options: people.map((p) => ({ value: p.id, label: p.name })) },
      ]}
      initial={{ ruleCode: meta.eventRules[0]?.code, eventDate: today(), label: '', personId: null }}
      onSave={async (v) => { await api(`/clients/${clientId}/events`, { body: v }); onSaved(); }}
      onClose={onClose}
    />
  );
}

// ---- Filing workflow dialog -----------------------------------------------------------------------------------
interface Move { action: string; label: string; note: 'required' | 'optional' | null; needsFiling: boolean; danger: boolean; blocked: string | null; override: number | null }
interface FilingDetail {
  obligation: Obligation & { reviewedAt: string | null; clientApprovedAt: string | null };
  moves: Move[]; settings: { requireReview: boolean; requireClientApproval: boolean }; formPack: boolean;
  history: { id: string; action: string; fromStage: string | null; toStage: string | null; note: string | null; userName: string | null; at: string }[];
  preparedBy: string | null; reviewedBy: string | null; clientApprovedBy: string | null;
}
const FLOW = (s: FilingDetail['settings']) => ['TODO', 'DATA', 'DRAFTED', ...(s.requireReview ? ['REVIEW'] : []), ...(s.requireClientApproval ? ['CLIENT'] : []), 'READY', 'FILED', 'APPROVED'];
const ACTION_WORD: Record<string, string> = { checked: 'Draft checked', override: 'Approved over the pre-filing check', start: 'Started', drafted: 'Drafted', submit: 'Sent for review', review_ok: 'Reviewed and approved', return: 'Returned for changes', client_ok: 'Client approved', client_return: 'Client sent back', filed: 'Filed on MCA', approved: 'Approved by MCA', resubmit: 'Resubmission asked', not_applicable: 'Marked not applicable', reopen: 'Reopened', status: 'Status changed' };

function FilingModal({ o, meta, onClose, onSaved }: { o: Obligation; meta?: Meta; onClose: () => void; onSaved: () => void }) {
  const { data, error, reload } = useLoad<FilingDetail>(`/obligations/${o.id}`);
  const { can, me } = useSession();
  const [pending, setPending] = useState<Move>();
  const [note, setNote] = useState('');
  const [srn, setSrn] = useState('');
  const [filedOn, setFiledOn] = useState(today());
  const [err, setErr] = useState<{ msg: string; details?: Record<string, string> }>();
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState<string | null>(o.assigneeId);
  const [notes, setNotes] = useState(o.notes ?? '');
  const clientUser = !!me?.user.clientIds.length;
  const docs = useReading();
  const [challan, setChallan] = useState(false);
  const [filesKey, setFilesKey] = useState(0);
  if (error) return <Modal title={o.form} onClose={onClose}><Alert kind="error">{error}</Alert></Modal>;
  if (!data) return <Modal title={o.form} onClose={onClose}><Spinner /></Modal>;
  const ob = data.obligation;
  const flow = FLOW(data.settings);
  const at = ob.stage === 'RESUBMIT' ? flow.indexOf('DRAFTED') : flow.indexOf(ob.stage);
  const go = async (m: Move) => {
    if ((m.note === 'required' || m.needsFiling || m.override || (m.action === 'client_ok' && !clientUser)) && pending?.action !== m.action) { setPending(m); setNote(''); setErr(undefined); return; }
    setBusy(true); setErr(undefined);
    try {
      await api(`/obligations/${o.id}/move`, { body: { action: m.action, note: note || null, srn: srn || null, filedOn: m.needsFiling ? filedOn : null, override: !!m.override } });
      setPending(undefined); setNote(''); setSrn(''); reload(); onSaved();
    } catch (e: any) { setErr({ msg: e.message, details: e.details }); } finally { setBusy(false); }
  };
  const saveDetails = async () => {
    setBusy(true); setErr(undefined);
    try { await api(`/obligations/${o.id}`, { method: 'PATCH', body: { assigneeId: assignee, notes } }); reload(); onSaved(); }
    catch (e: any) { setErr({ msg: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${ob.form} — ${o.clientName}`} wide onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {ob.title}{ob.periodLabel && ` · ${ob.periodLabel}`} · {fyLabel(ob.fy)} · due <strong>{fmtDate(ob.dueDate)}</strong>{ob.provisional && ' (estimated)'}{o.law && ` · ${o.law}`}
        {o.lateFee ? <span className="overdue"> · late fee so far {money(o.lateFee)}</span> : null}
      </p>

      {ob.stage === 'NA' ? <Alert kind="info">Marked not applicable.</Alert> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', margin: '4px 0 12px' }}>
          {flow.map((st, i) => (
            <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className={`badge ${i < at || (st === 'APPROVED' && ob.stage === 'APPROVED') ? 'badge-approved' : i === at ? 'badge-under_review' : ''}`} style={i === at ? { outline: '2px solid currentColor' } : undefined}>{i < at ? '✓ ' : ''}{STAGE[st][0]}</span>
              {i < flow.length - 1 && <span className="muted small">→</span>}
            </span>
          ))}
          {ob.stage === 'RESUBMIT' && <span className="badge badge-rejected">Resubmission asked by MCA</span>}
        </div>
      )}
      <p className="small" style={{ margin: '0 0 10px' }}>
        {data.preparedBy && <>Prepared by <strong>{data.preparedBy}</strong>. </>}
        {data.reviewedBy && <>Reviewed by <strong>{data.reviewedBy}</strong> on {fmtDateTime(ob.reviewedAt)}. </>}
        {data.clientApprovedBy && <>Client approval recorded by <strong>{data.clientApprovedBy}</strong> on {fmtDateTime(ob.clientApprovedAt)}. </>}
        {ob.srn && <>SRN <strong className="mono">{ob.srn}</strong>, filed {fmtDate(ob.filedOn)}.</>}
      </p>

      {err && <Alert kind="error">{err.msg}{err.details && Object.values(err.details).length > 0 && <> — {Object.values(err.details).join('; ')}</>}</Alert>}
      {data.moves.length > 0 && (
        <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            {data.moves.map((m) => (
              <button key={m.action} className={`btn btn-sm ${m.danger ? 'btn-danger-ghost' : pending?.action === m.action || data.moves.filter((x) => !x.danger && !x.blocked)[0]?.action === m.action ? 'btn-primary' : 'btn-secondary'}`}
                disabled={busy || !!m.blocked} title={m.blocked ?? undefined} onClick={() => go(m)}>{m.label}</button>
            ))}
          </div>
          {data.moves.filter((m) => m.blocked).map((m) => <span key={m.action} className="muted small">{m.label}: {m.blocked}</span>)}
          {data.moves.filter((m) => m.override && pending?.action !== m.action).map((m) => <span key={`o${m.action}`} className="warn-text small">The pre-filing check has {m.override} {m.override === 1 ? 'issue' : 'issues'} to fix — you can still {m.action === 'filed' ? 'file' : 'approve'}, giving a reason.</span>)}
          {pending && (
            <div className="card pad stack" style={{ gap: 8, background: 'var(--surface-2, #f6f7fb)' }}>
              <strong className="small">{pending.label}</strong>
              {pending.needsFiling && docs?.enabled && meta && <span className="small">Have the challan? <a href="#" onClick={(e) => { e.preventDefault(); setChallan(true); }}>Read the SRN and date from it</a></span>}
              {pending.needsFiling && <div className="field-grid">
                <div className="field"><label htmlFor="srn">SRN</label><input id="srn" className="mono" value={srn} onChange={(e) => setSrn(e.target.value.toUpperCase())} placeholder="AB1234567" /></div>
                <div className="field"><label htmlFor="fo">Filed on</label><input id="fo" type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} /></div>
              </div>}
              <div className="field"><label htmlFor="nt">{pending.override ? `Why ${pending.action === 'filed' ? 'file' : 'approve'} despite ${pending.override} ${pending.override === 1 ? 'issue' : 'issues'} to fix? (required — kept in the history)` : pending.action === 'client_ok' && !clientUser ? 'How did the client approve? (required)' : pending.note === 'required' ? 'Note (required)' : 'Note'}</label>
                <textarea id="nt" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={pending.action === 'client_ok' ? 'e.g. Approved by Ms. Rao by email on 24 Nov' : pending.action === 'return' || pending.action === 'client_return' ? 'What needs changing?' : ''} /></div>
              <div className="btn-row"><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => go(pending)}>Confirm</button><button className="btn btn-secondary btn-sm" onClick={() => setPending(undefined)}>Cancel</button></div>
            </div>
          )}
        </div>
      )}

      {!clientUser && (can('compliance.work') || can('compliance.approve')) && data.formPack && ob.stage !== 'NA' && (
        <div className="card pad" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span><strong>MCA form data</strong><span className="muted small block">Every field of the {ob.form} form, filled from the records — copy into the V3 portal, or download as Excel.</span></span>
          <span className="grow" /><Link className="btn btn-sm btn-primary" to={`/filings/${o.id}/form`} onClick={onClose}>Open {ob.form} form data</Link>
        </div>
      )}
      {!clientUser && (can('compliance.work') || can('compliance.approve')) && ob.stage !== 'NA' && (
        <ReviewCheck key={`rc${filesKey}`} obligationId={o.id} open={['DRAFTED', 'REVIEW', 'READY', 'RESUBMIT'].includes(ob.stage)} />
      )}
      {!clientUser && can('compliance.work') && (
        <div className="field-grid" style={{ marginBottom: 6 }}>
          <div className="field"><label htmlFor="as">Assigned to</label><select id="as" value={assignee ?? ''} onChange={(e) => setAssignee(e.target.value || null)}><option value="">—</option>{(meta?.staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="field field-wide"><label htmlFor="nn">Notes</label><textarea id="nn" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div><button className="btn btn-secondary btn-sm" disabled={busy || (assignee === o.assigneeId && notes === (o.notes ?? ''))} onClick={saveDetails}>Save assignee &amp; notes</button></div>
        </div>
      )}

      <h4 style={{ margin: '14px 0 6px' }}>Documents</h4>
      {challan && meta && <ReadDocument kinds={['SRN_CHALLAN']} obligationId={o.id} meta={meta} title="Read the challan"
        onClose={() => setChallan(false)} onDone={(r) => { if (r.srn) setSrn(r.srn); if (r.filedOn) setFiledOn(r.filedOn); setFilesKey((k) => k + 1); }} />}
      <Attachments key={filesKey} onChange={() => setFilesKey((k) => k + 1)} entity="obligation" entityId={o.id} canAdd={can('compliance.work') || can('compliance.client_approve')} canRemove={can('compliance.work') && !clientUser} />

      <TimeLog obligationId={o.id} />

      <h4 style={{ margin: '16px 0 6px' }}>History</h4>
      {data.history.length === 0 ? <p className="muted small">Nothing yet.</p> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="small">
          {data.history.map((h) => <li key={h.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--border, #eee)' }}>
            <span className="muted nowrap">{fmtDateTime(h.at)}</span> · <strong>{ACTION_WORD[h.action] ?? h.action}</strong> by {h.userName ?? '—'}{h.note && <span> — “{h.note}”</span>}
          </li>)}
        </ul>
      )}
    </Modal>
  );
}
