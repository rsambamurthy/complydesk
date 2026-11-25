/**
 * A client company's own users (Client Admin / Client Viewer), managed from the client's page:
 * add a person from the company, give an existing client user access too, or take access away.
 */
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { Alert, Empty, Modal, Spinner } from './ui';
import { RecordModal } from './RecordForm';

interface U { id: string; name: string; email: string; status: string; clientIds: string[]; roleIds: string[]; lastLoginAt: string | null }
interface Role { id: string; key: string; name: string; description: string | null }

export function ClientUsers({ clientId, clientName }: { clientId: string; clientName: string }) {
  const here = useLoad<U[]>(`/admin/users?clientId=${clientId}`);
  const roles = useLoad<Role[]>('/admin/roles');
  const [adding, setAdding] = useState<'new' | 'existing'>();
  const [err, setErr] = useState<string>();
  if (here.error || roles.error) return <Alert kind="error">{here.error ?? roles.error}</Alert>;
  if (!here.data || !roles.data) return <Spinner />;
  const clientRoles = roles.data.filter((r) => r.key.startsWith('CLIENT_'));
  const roleName = (ids: string[]) => roles.data!.filter((r) => ids.includes(r.id)).map((r) => r.name).join(', ');
  const revoke = async (u: U) => {
    if (!window.confirm(`Remove ${u.name}'s access to ${clientName}?`)) return;
    setErr(undefined);
    try { await api(`/admin/users/${u.id}/client-access`, { body: { clientId, grant: false } }); here.reload(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      <div className="toolbar"><h3>People from {clientName}</h3><span className="grow" />
        <button className="btn btn-sm btn-secondary" onClick={() => setAdding('existing')}>Give an existing user access</button>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding('new')}>Add a person</button></div>
      <p className="muted small" style={{ marginTop: 0 }}>They sign in to your workspace and see only the companies they’re given — their calendar, filings and records.</p>
      {err && <Alert kind="error">{err}</Alert>}
      {here.data.length === 0 ? <Empty>No one from this company has access yet.</Empty> : (
        <table className="table compact static"><thead><tr><th>Name</th><th>Role</th><th>Companies</th><th>Last sign-in</th><th /></tr></thead><tbody>
          {here.data.map((u) => <tr key={u.id}>
            <td><strong>{u.name}</strong><span className="muted small block">{u.email}</span>{u.status !== 'ACTIVE' && <span className="badge sm">Disabled</span>}</td>
            <td className="small">{roleName(u.roleIds)}</td>
            <td className="small">{u.clientIds.length === 1 ? 'Only this one' : `${u.clientIds.length} companies`}</td>
            <td className="small">{fmtDateTime(u.lastLoginAt)}</td>
            <td><button className="btn btn-sm btn-danger-ghost" onClick={() => revoke(u)}>Remove access</button></td>
          </tr>)}
        </tbody></table>
      )}
      {adding === 'new' && (
        <RecordModal title={`Add a person from ${clientName}`} saveLabel="Add"
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'email', label: 'Email', type: 'email', required: true },
            { key: 'role', label: 'Role', type: 'select', required: true, options: clientRoles.map((r) => ({ value: r.id, label: `${r.name} — ${r.description ?? ''}` })) },
            { key: 'password', label: 'First password', type: 'password', required: true, help: 'At least 10 characters. Share it with them securely.' },
            { key: 'mobile', label: 'Mobile (for WhatsApp)', placeholder: '10 digits' },
            { key: 'whatsappOptIn', label: 'They agreed to receive WhatsApp messages', type: 'checkbox', wide: true, show: (v) => !!v.mobile },
          ]}
          initial={{ role: clientRoles.find((r) => r.key === 'CLIENT_VIEWER')?.id }}
          onSave={async (v) => { await api('/admin/users', { body: { name: v.name, email: v.email, password: v.password, roleIds: [v.role], clientIds: [clientId], status: 'ACTIVE', mobile: v.mobile || null, whatsappOptIn: !!v.whatsappOptIn && !!v.mobile } }); here.reload(); }}
          onClose={() => setAdding(undefined)} />
      )}
      {adding === 'existing' && <ExistingUser clientId={clientId} clientName={clientName} clientRoleIds={clientRoles.map((r) => r.id)} have={here.data.map((u) => u.id)} onClose={() => setAdding(undefined)} onDone={here.reload} />}
    </>
  );
}

/** For someone who already looks after another group company: search client users by name or email. */
function ExistingUser({ clientId, clientName, clientRoleIds, have, onClose, onDone }: { clientId: string; clientName: string; clientRoleIds: string[]; have: string[]; onClose: () => void; onDone: () => void }) {
  const all = useLoad<U[]>('/admin/users');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string>();
  const list = useMemo(() => (all.data ?? []).filter((u) => !have.includes(u.id) && u.roleIds.some((r) => clientRoleIds.includes(r)) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 20), [all.data, q, have, clientRoleIds]);
  return (
    <Modal title={`Give an existing user access to ${clientName}`} onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {err && <Alert kind="error">{err}</Alert>}
      <input autoFocus placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!all.data ? <Spinner /> : list.length === 0 ? <p className="muted small">No other client users match.</p> : (
        <table className="table compact static" style={{ marginTop: 8 }}><tbody>{list.map((u) => (
          <tr key={u.id}><td><strong>{u.name}</strong><span className="muted small block">{u.email} · {u.clientIds.length} compan{u.clientIds.length === 1 ? 'y' : 'ies'}</span></td>
            <td style={{ textAlign: 'end' }}><button className="btn btn-sm btn-primary" onClick={async () => {
              try { await api(`/admin/users/${u.id}/client-access`, { body: { clientId, grant: true } }); onDone(); onClose(); } catch (e: any) { setErr(e.message); }
            }}>Give access</button></td></tr>))}</tbody></table>
      )}
    </Modal>
  );
}
