import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad, useMeta } from '../lib/hooks';
import type { Client } from '../lib/types';
import { COMPANY_TYPE, fmtDate } from '../lib/format';
import { Alert, Empty, Spinner } from '../components/ui';
import { RecordModal } from '../components/RecordForm';
import { clientFields, formToClient } from '../components/ClientForms';
import { useSession } from '../lib/session';
import { ReadDocument, usePortalRead, useReading } from '../components/DocumentReader';

export function Clients() {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [reading, setReading] = useState(false);
  const docs = useReading();
  const [portal, portalErr, closePortal] = usePortalRead();
  const { data, error, reload } = useLoad<Client[]>(`/clients?q=${encodeURIComponent(q)}`);
  const meta = useMeta();
  const nav = useNavigate();
  const { can } = useSession();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Clients</h1><p className="muted">Companies you look after.</p></div>
        {can('clients.manage') && <div className="head-actions">
          <Link className="btn btn-secondary" to="/clients/import">Import from Excel</Link>
          {docs?.enabled && <button className="btn btn-secondary" onClick={() => setReading(true)} disabled={!meta}>Add from MCA master data</button>}
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!meta}>Add client</button>
        </div>}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {portalErr && <Alert kind="error">{portalErr}</Alert>}
      <section className="card">
        <div className="toolbar"><input className="search" placeholder="Search by name or CIN" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!data ? <Spinner /> : data.length === 0 ? <Empty>No clients yet. Add one, read it from the MCA master data, or import a list from Excel.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Company</th><th>Type</th><th>Handled by</th><th className="num">Overdue</th><th className="num">Due in 30 days</th><th>Next due</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id} onClick={() => nav(`/clients/${c.id}`)}>
                <td><strong>{c.name}</strong><span className="muted small block mono">{c.cin}</span></td>
                <td className="small">{COMPANY_TYPE[c.companyType]}{c.smallCompany && <span className="block muted">Small company</span>}</td>
                <td className="small">{c.ownerName ?? '—'}</td>
                <td className="num">{c.overdue ? <span className="overdue">{c.overdue}</span> : <span className="muted">0</span>}</td>
                <td className="num">{c.due30 || <span className="muted">0</span>}</td>
                <td className="small">{fmtDate(c.nextDue)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {reading && meta && <ReadDocument kinds={['MCA_MASTER', 'INCORPORATION']} meta={meta} title="Add a client from a document" onClose={() => setReading(false)} onDone={(o) => { reload(); nav(`/clients/${o.clientId}`); }} />}
      {portal && meta && <ReadDocument kinds={['MCA_MASTER']} initial={portal} meta={meta} title="Add a client from MCA master data" onClose={closePortal} onDone={(o) => { reload(); nav(`/clients/${o.clientId}`); }} />}
      {adding && meta && (
        <RecordModal title="Add client" fields={clientFields(meta)} saveLabel="Add client"
          initial={{ companyType: 'PRIVATE', smallCompany: false }}
          onSave={async (v) => { const c = await api<Client>('/clients', { body: formToClient(v) }); reload(); nav(`/clients/${c.id}`); }}
          onClose={() => setAdding(false)} />
      )}
    </div>
  );
}
