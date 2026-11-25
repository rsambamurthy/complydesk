/** Documents asked of a client (WhatsApp + email to its users): open requests, ask for more, mark received. */
import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { fmtDate, fmtDateTime, today, addDays } from '../lib/format';
import { RecordModal } from './RecordForm';
import { Alert } from './ui';

interface Req { id: string; items: string[]; note: string | null; dueDate: string | null; status: string; sentTo: { name: string; email: string; whatsapp: boolean }[]; requestedByName: string | null; createdAt: string; closedAt: string | null }

export function DocRequests({ clientId }: { clientId: string }) {
  const { data, error, reload } = useLoad<Req[]>(`/clients/${clientId}/doc-requests`);
  const { can, me } = useSession();
  const [asking, setAsking] = useState(false);
  const [all, setAll] = useState(false);
  const staff = !me?.user.clientIds.length;
  if (error) return <Alert kind="error">{error}</Alert>;
  const rows = (data ?? []).filter((r) => all || r.status === 'OPEN');
  const set = async (id: string, status: string) => { await api(`/clients/doc-requests/${id}`, { method: 'PATCH', body: { status } }); reload(); };
  return (
    <div className="doc-reqs">
      <div className="toolbar" style={{ padding: 0 }}>
        <b>{staff ? 'Documents requested from the client' : 'Documents your CS has asked for'}</b><span className="grow" />
        {(data ?? []).some((r) => r.status !== 'OPEN') && <button className="link-btn small" onClick={() => setAll(!all)}>{all ? 'Open only' : 'Show all'}</button>}
        {staff && can('compliance.work') && <button className="btn btn-sm btn-secondary" onClick={() => setAsking(true)}>Request documents</button>}
      </div>
      {!rows.length ? <p className="muted small" style={{ margin: '4px 0 0' }}>{staff ? 'No open requests.' : 'Nothing requested right now.'}</p> : rows.map((r) => (
        <div key={r.id} className={`doc-req ${r.status.toLowerCase()}`}>
          <div className="toolbar" style={{ padding: 0 }}>
            <span className="small"><b>{r.status === 'OPEN' ? (r.dueDate && r.dueDate < today() ? <span className="overdue">Overdue</span> : `Due ${r.dueDate ? fmtDate(r.dueDate) : '—'}`) : r.status === 'RECEIVED' ? '✓ Received' : 'Cancelled'}</b> · asked {fmtDateTime(r.createdAt)}{r.requestedByName ? ` by ${r.requestedByName}` : ''}</span>
            <span className="grow" />
            {staff && can('compliance.work') && (r.status === 'OPEN'
              ? <><button className="btn btn-sm btn-primary" onClick={() => set(r.id, 'RECEIVED')}>Received</button><button className="link-btn small" onClick={() => set(r.id, 'CANCELLED')}>Cancel</button></>
              : <button className="link-btn small" onClick={() => set(r.id, 'OPEN')}>Reopen</button>)}
          </div>
          <ul className="small" style={{ margin: '4px 0', paddingInlineStart: 18 }}>{r.items.map((i) => <li key={i}>{i}</li>)}</ul>
          {r.note && <div className="small muted">{r.note}</div>}
          {staff && <div className="small muted">Sent to {r.sentTo.map((s) => `${s.name}${s.whatsapp ? ' (WhatsApp + email)' : ' (email)'}`).join(', ')}</div>}
        </div>
      ))}
      {!staff && rows.some((r) => r.status === 'OPEN') && <p className="small" style={{ marginBottom: 0 }}>Upload them below — your CS is notified when you do.</p>}
      {asking && (
        <RecordModal title="Request documents from the client" saveLabel="Send request" initial={{ items: '', dueDate: addDays(today(), 7) }}
          extra={<p className="muted small" style={{ marginTop: 0 }}>Goes to the client’s users by email, and by WhatsApp to those who agreed to it (if WhatsApp is on in Settings). They upload in this Documents tab.</p>}
          fields={[
            { key: 'items', label: 'Documents needed (one per line)', type: 'textarea', required: true, wide: true, placeholder: 'Audited financial statements FY 2025-26\nBank statement for March 2026' },
            { key: 'dueDate', label: 'Needed by', type: 'date' },
            { key: 'note', label: 'Note', type: 'textarea', wide: true },
          ]}
          onSave={async (v) => { await api(`/clients/${clientId}/doc-requests`, { body: { items: String(v.items).split('\n').map((x) => x.trim()).filter(Boolean), dueDate: v.dueDate, note: v.note } }); reload(); }}
          onClose={() => setAsking(false)} />
      )}
    </div>
  );
}
