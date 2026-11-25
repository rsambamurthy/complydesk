/** Meetings shared pieces: labels, status badge, the list (Meetings page and a client's Meetings tab) and "Schedule a meeting". */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate, today } from '../lib/format';
import { Empty } from './ui';
import { RecordModal } from './RecordForm';
import { ClientPicker } from './ClientPicker';

export const MEETING_TYPE: Record<string, string> = { BOARD: 'Board meeting', AGM: 'Annual general meeting', EGM: 'Extraordinary general meeting' };
export const MEETING_STATUS: Record<string, [string, string]> = {
  SCHEDULED: ['Scheduled', 'badge-invited'], NOTICE_SENT: ['Notice sent', 'badge-under_review'], HELD: ['Held — minutes pending', 'badge-under_review'],
  MINUTES_SIGNED: ['Minutes signed', 'badge-approved'], CANCELLED: ['Cancelled', ''],
};
export const MODE: Record<string, string> = { PHYSICAL: 'In person', VIDEO: 'Video conference', HYBRID: 'In person + video' };
export const MeetingStatus = ({ status }: { status: string }) => { const [l, c] = MEETING_STATUS[status] ?? [status, '']; return <span className={`badge ${c}`}>{l}</span>; };

export interface MeetingRow { m: { id: string; clientId: string; type: string; title: string; date: string; time: string | null; status: string; heldOn: string | null; mode: string }; clientName: string; cin: string; items: number }

export function MeetingList({ rows, showClient = true, empty }: { rows: MeetingRow[]; showClient?: boolean; empty: string }) {
  const nav = useNavigate();
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Date</th>{showClient && <th>Company</th>}<th>Meeting</th><th>Status</th><th className="num">Agenda items</th></tr></thead>
      <tbody>{rows.map(({ m, clientName, cin, items }) => (
        <tr key={m.id} onClick={() => nav(`/meetings/${m.id}`)}>
          <td className="nowrap">{fmtDate(m.heldOn ?? m.date)}{m.time && <span className="muted small block">{m.time}</span>}</td>
          {showClient && <td><Link to={`/clients/${m.clientId}`} onClick={(e) => e.stopPropagation()}>{clientName}</Link><span className="muted small block mono">{cin}</span></td>}
          <td><strong>{m.title}</strong><span className="muted small block">{MEETING_TYPE[m.type]} · {MODE[m.mode]}</span></td>
          <td><MeetingStatus status={m.status} /></td>
          <td className="num">{items}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** Schedule a meeting — from the Meetings page (pick the company) or a client's page (company fixed). */
export function ScheduleMeeting({ clientId, onClose }: { clientId?: string; onClose: () => void }) {
  const nav = useNavigate();
  return (
    <RecordModal title="Schedule a meeting" saveLabel="Schedule"
      fields={[
        ...(clientId ? [] : [{ key: 'clientIds', label: 'Company', type: 'custom' as const, required: true, wide: true,
          render: (v: string[], set: (x: string[]) => void) => <ClientPicker value={v ?? []} onChange={(ids) => set(ids.slice(-1))} placeholder="Type a company name or CIN…" autoFocus /> }]),
        { key: 'type', label: 'Meeting', type: 'select', required: true, options: Object.entries(MEETING_TYPE).map(([value, label]) => ({ value, label })) },
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'time', label: 'Time', placeholder: 'e.g. 11:00 AM' },
        { key: 'mode', label: 'How', type: 'select', required: true, options: Object.entries(MODE).map(([value, label]) => ({ value, label })) },
        { key: 'venue', label: 'Venue', wide: true, placeholder: 'Defaults to the registered office', show: (v) => v.mode !== 'VIDEO' },
        { key: 'videoLink', label: 'Video link', wide: true, show: (v) => v.mode !== 'PHYSICAL' },
      ]}
      initial={{ type: 'BOARD', mode: 'PHYSICAL', date: today(), clientIds: [] }}
      onSave={async (v) => {
        const x = await api('/meetings', { body: { clientId: clientId ?? v.clientIds?.[0] ?? '', type: v.type, date: v.date, time: v.time, mode: v.mode, venue: v.venue, videoLink: v.videoLink } });
        nav(`/meetings/${x.id}`);
      }}
      onClose={onClose} />
  );
}

export function ScheduleButton({ clientId }: { clientId?: string }) {
  const [open, setOpen] = useState(false);
  return <>{<button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>Schedule a meeting</button>}{open && <ScheduleMeeting clientId={clientId} onClose={() => setOpen(false)} />}</>;
}
