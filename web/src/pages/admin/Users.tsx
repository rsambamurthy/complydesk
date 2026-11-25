import { useState } from 'react';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/hooks';
import { ClientPicker } from '../../components/ClientPicker';
import { fmtDateTime } from '../../lib/format';
import { Alert, Spinner } from '../../components/ui';
import { RecordModal, type FieldDef } from '../../components/RecordForm';

interface U { id: string; name: string; email: string; status: string; clientIds: string[]; roleIds: string[]; lastLoginAt: string | null; remindersOff: boolean; mobile: string | null; whatsappOptInAt: string | null }
interface Role { id: string; key: string; name: string; description: string | null }

export function Users() {
  const users = useLoad<U[]>('/admin/users');
  const roles = useLoad<Role[]>('/admin/roles');
  const [open, setOpen] = useState<U | 'new'>();
  if (users.error) return <div className="page"><Alert kind="error">{users.error}</Alert></div>;
  if (!users.data || !roles.data) return <Spinner />;
  const roleName = (id: string) => roles.data!.find((r) => r.id === id)?.name ?? '';
  const clientRoleIds = roles.data.filter((r) => r.key.startsWith('CLIENT_')).map((r) => r.id);
  const fields: FieldDef[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'password', label: open === 'new' ? 'First password' : 'New password', type: 'password', help: open === 'new' ? 'At least 10 characters. Share it with the user securely.' : 'Leave empty to keep the current one.' },
    { key: 'mobile', label: 'Mobile', placeholder: '10 digits' },
    { key: 'whatsappOptIn', label: 'They agreed to receive WhatsApp messages', type: 'checkbox', help: 'Approval requests, document requests and reminders — sent only if WhatsApp is switched on in Settings. Record consent only when the person has given it.', show: (v) => !!v.mobile },
    { key: 'dailyEmail', label: 'Daily reminder email', type: 'checkbox', help: 'Due, overdue and waiting items — only on days there is something.' },
    { key: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }] },
    { key: 'roleIds', label: 'Roles', type: 'checks', options: roles.data.map((r) => ({ value: r.id, label: `${r.name} — ${r.description ?? ''}` })) },
    { key: 'clientIds', label: 'Client companies this user belongs to', type: 'custom', wide: true, show: (v) => (v.roleIds ?? []).some((id: string) => clientRoleIds.includes(id)),
      help: 'Search by name or CIN. A client user sees only these companies.',
      render: (v, set) => <ClientPicker value={v ?? []} onChange={set} /> },
  ];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Users</h1><p className="muted">Your team and your clients’ own users.</p></div>
        <div className="head-actions"><button className="btn btn-primary" onClick={() => setOpen('new')}>Add user</button></div></div>
      <section className="card"><div className="table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>Roles</th><th>Status</th><th>Last sign-in</th></tr></thead>
        <tbody>{users.data.map((u) => (
          <tr key={u.id} onClick={() => setOpen(u)}>
            <td><strong>{u.name}</strong><span className="muted small block">{u.email}</span></td>
            <td>{u.roleIds.map((id) => <span key={id} className="chip">{roleName(id)}</span>)}{u.clientIds.length > 0 && <span className="muted small block">{u.clientIds.length} client compan{u.clientIds.length === 1 ? 'y' : 'ies'}</span>}</td>
            <td>{u.status === 'ACTIVE' ? <span className="badge badge-approved">Active</span> : <span className="badge">Disabled</span>}</td>
            <td className="small">{fmtDateTime(u.lastLoginAt)}</td>
          </tr>
        ))}</tbody>
      </table></div></section>
      {open && (
        <RecordModal title={open === 'new' ? 'Add user' : `Edit ${open.name}`} fields={fields}
          initial={open === 'new' ? { status: 'ACTIVE', roleIds: [], clientIds: [], dailyEmail: true } : { ...open, password: '', dailyEmail: !open.remindersOff, whatsappOptIn: !!open.whatsappOptInAt }}
          onSave={async (v) => {
            const body = { name: v.name, email: v.email, password: v.password, status: v.status, remindersOff: !v.dailyEmail, mobile: v.mobile || null, whatsappOptIn: !!v.whatsappOptIn && !!v.mobile, roleIds: v.roleIds, clientIds: (v.roleIds ?? []).some((id: string) => clientRoleIds.includes(id)) ? v.clientIds : [] };
            await api(open === 'new' ? '/admin/users' : `/admin/users/${open.id}`, { method: open === 'new' ? 'POST' : 'PATCH', body });
            users.reload();
          }}
          onClose={() => setOpen(undefined)} />
      )}
    </div>
  );
}
