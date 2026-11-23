/**
 * Obligations, shared by the dashboard, the compliance calendar and a client's Compliance tab:
 * the table, the update dialog (status, held/filed date, SRN, assignee) and the "Add event-based filing" dialog.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Meta, Obligation, Person } from '../lib/types';
import { doneWord, fmtDate, fyLabel, isMeeting, money, today } from '../lib/format';
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
            <tr key={o.id} onClick={() => can('compliance.work') && setOpen(o)} className={can('compliance.work') ? '' : 'no-hover'}>
              <td><DueDate date={o.dueDate} status={o.status} provisional={o.provisional} /></td>
              {showClient && <td><Link to={`/clients/${o.clientId}`} onClick={(e) => e.stopPropagation()}>{o.clientName}</Link><span className="muted small block mono">{o.cin}</span></td>}
              <td><strong>{o.form}</strong><span className="muted small block">{o.title}</span></td>
              <td className="small">{fyLabel(o.fy)}{o.periodLabel && <span className="block muted">{o.periodLabel}</span>}</td>
              <td><StatusBadge status={o.status} />{o.status === 'FILED' && <span className="small muted block">{doneWord(o.form)} {fmtDate(o.filedOn)}{o.srn && ` · ${o.srn}`}</span>}</td>
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

export function ObligationModal({ o, meta, onClose, onSaved }: { o: Obligation; meta?: Meta; onClose: () => void; onSaved: () => void }) {
  const meeting = isMeeting(o.form);
  const fields: FieldDef[] = [
    { key: 'status', label: 'Status', type: 'select', required: true, options: [
      { value: 'OPEN', label: 'Open' }, { value: 'IN_PROGRESS', label: 'In progress' },
      { value: 'FILED', label: meeting ? 'Held' : 'Filed' }, { value: 'NOT_APPLICABLE', label: 'Not applicable' },
    ] },
    { key: 'filedOn', label: meeting ? 'Held on' : 'Filed on', type: 'date', show: (v) => v.status === 'FILED', required: true,
      help: o.ruleCode === 'AGM' ? 'AOC-4, MGT-7 and ADT-1 due dates follow this date.' : meeting ? 'The first meeting of the year sets the MBP-1 / DIR-8 date.' : undefined },
    { key: 'srn', label: 'SRN', show: (v) => v.status === 'FILED' && !meeting, placeholder: 'e.g. F12345678' },
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
