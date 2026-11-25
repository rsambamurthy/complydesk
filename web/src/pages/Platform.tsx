/** Integrata platform console: sign-up approval switch, trial terms, every firm's workspace and actions. */
import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Alert, Modal, Spinner } from '../components/ui';
import { Fields, useRecordForm } from '../components/RecordForm';
import type { Access } from '../lib/types';

interface Settings { requireApproval: boolean; trialDays: number; trialClientLimit: number | null; mailConfigured: boolean }
interface T {
  id: string; slug: string; name: string; status: string; trialEndsAt: string | null; paidUntil: string | null; city: string | null; icsiNumber: string | null;
  gstin: string | null; contactEmail: string | null; contactMobile: string | null; source: string; platformNotes: string | null; createdAt: string;
  clients: number; users: number; lastLogin: string | null; admin: string | null; verified: boolean; access: Access;
}
const STATE: Record<string, [string, string]> = {
  PENDING_APPROVAL: ['Awaiting approval', 'badge-invited'], TRIAL: ['Trial', 'badge-under_review'], ACTIVE: ['Active', 'badge-approved'],
  TRIAL_ENDED: ['Trial ended', 'badge-rejected'], PAYMENT_DUE: ['Payment due', 'badge-rejected'], SUSPENDED: ['Suspended', ''],
};

export function Platform() {
  const settings = useLoad<Settings>('/platform/settings');
  const tenants = useLoad<T[]>('/platform/tenants');
  const [open, setOpen] = useState<T>();
  const [filter, setFilter] = useState('');
  if (settings.error) return <div className="page"><Alert kind="error">{settings.error}</Alert></div>;
  if (!settings.data || !tenants.data) return <Spinner />;
  const rows = tenants.data.filter((t) => !filter || t.access.state === filter);
  const count = (s: string) => tenants.data!.filter((t) => t.access.state === s).length;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Platform console</h1><p className="muted">Every firm on ComplyDesk. Integrata only.</p></div></div>
      {!settings.data.mailConfigured && <Alert kind="warning">Email isn’t set up yet (SMTP_* variables), so verification and approval emails are only written to the server log.</Alert>}
      <TestEmail />
      <SettingsCard s={settings.data} onSaved={settings.reload} />
      <section className="card">
        <div className="toolbar">
          <div className="seg">
            {[['', `All (${tenants.data.length})`], ['PENDING_APPROVAL', `Awaiting approval (${count('PENDING_APPROVAL')})`], ['TRIAL', `Trial (${count('TRIAL')})`], ['ACTIVE', `Active (${count('ACTIVE')})`], ['TRIAL_ENDED', `Trial ended (${count('TRIAL_ENDED')})`], ['SUSPENDED', `Suspended (${count('SUSPENDED')})`]]
              .map(([k, l]) => <button key={k} className={`seg-btn ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Firm</th><th>Admin</th><th>Status</th><th className="num">Clients</th><th className="num">Users</th><th>Last sign-in</th><th>Signed up</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id} onClick={() => setOpen(t)}>
              <td><strong>{t.name}</strong><span className="muted small block"><span className="mono">{t.slug}</span>{t.city && ` · ${t.city}`}</span></td>
              <td className="small">{t.admin ?? t.contactEmail}{!t.verified && <span className="block warn-text">Email not confirmed</span>}<span className="block muted">{t.contactMobile}</span></td>
              <td><StatusCell t={t} /></td>
              <td className="num">{t.clients}</td><td className="num">{t.users}</td>
              <td className="small">{fmtDateTime(t.lastLogin)}</td><td className="small">{fmtDate(t.createdAt.slice(0, 10))}<span className="muted block">{t.source === 'SIGNUP' ? 'Self sign-up' : 'Created by Integrata'}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      {open && <TenantModal t={open} onClose={() => setOpen(undefined)} onDone={() => { tenants.reload(); setOpen(undefined); }} />}
    </div>
  );
}

function StatusCell({ t }: { t: T }) {
  const [label, cls] = STATE[t.access.state] ?? [t.status, ''];
  return <><span className={`badge ${cls}`}>{label}</span>
    {t.access.state === 'TRIAL' && <span className="small muted block">{t.access.daysLeft} days left</span>}
    {t.status === 'ACTIVE' && t.paidUntil && <span className="small muted block">Paid to {fmtDate(t.paidUntil.slice(0, 10))}</span>}</>;
}

function SettingsCard({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const form = useRecordForm({ requireApproval: s.requireApproval, trialDays: s.trialDays, trialClientLimit: s.trialClientLimit ?? '' });
  const [saved, setSaved] = useState(false);
  return (
    <section className="card pad stack">
      <h3 style={{ margin: 0 }}>Sign-up settings</h3>
      {form.error && <Alert kind="error">{form.error}</Alert>}
      {saved && <Alert kind="success">Saved. Applies to new sign-ups from now on.</Alert>}
      <Fields form={form} fields={[
        { key: 'requireApproval', label: 'New sign-ups need my approval', type: 'checkbox', wide: true, help: 'Off: a firm signs up and its trial starts at once. On: the workspace waits until you approve it here (you get an email).' },
        { key: 'trialDays', label: 'Trial length (days)', type: 'number', required: true },
        { key: 'trialClientLimit', label: 'Client companies allowed in the trial', type: 'number', help: 'Empty = no limit.' },
      ]} />
      <div><button className="btn btn-primary" disabled={form.busy} onClick={() => form.submit(async (v) => {
        await api('/platform/settings', { method: 'PUT', body: { requireApproval: !!v.requireApproval, trialDays: Number(v.trialDays), trialClientLimit: v.trialClientLimit === '' || v.trialClientLimit == null ? null : Number(v.trialClientLimit) } });
        setSaved(true); onSaved();
      })}>Save settings</button></div>
    </section>
  );
}

function TenantModal({ t, onClose, onDone }: { t: T; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [days, setDays] = useState(15);
  const [months, setMonths] = useState(12);
  const [notes, setNotes] = useState(t.platformNotes ?? '');
  const act = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setErr(undefined);
    try { await api(`/platform/tenants/${t.id}`, { body }); onDone(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={t.name} wide onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {err && <Alert kind="error">{err}</Alert>}
      <dl className="kv">
        <dt>Workspace code</dt><dd className="mono">{t.slug}</dd>
        <dt>Status</dt><dd><StatusCell t={t} />{t.trialEndsAt && <span className="small muted"> · trial to {fmtDate(t.trialEndsAt.slice(0, 10))}</span>}</dd>
        <dt>Contact</dt><dd>{t.contactEmail ?? t.admin} · {t.contactMobile ?? '—'}</dd>
        <dt>City / ICSI / GSTIN</dt><dd>{t.city ?? '—'} · {t.icsiNumber ?? '—'} · {t.gstin ?? '—'}</dd>
        <dt>Use</dt><dd>{t.clients} client companies · {t.users} users · last sign-in {fmtDateTime(t.lastLogin)}</dd>
      </dl>
      <div className="stack" style={{ marginTop: 16 }}>
        {t.status === 'PENDING_APPROVAL' && <div><button className="btn btn-primary" disabled={busy} onClick={() => act({ action: 'approve' })}>Approve — start the trial</button></div>}
        <div className="btn-row"><input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 90 }} aria-label="Days" />
          <button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: 'extend_trial', days })}>Extend trial by {days} days</button></div>
        <div className="btn-row"><input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ width: 90 }} aria-label="Months" />
          <button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: 'activate', months })}>Mark paid — active for {months} months</button></div>
        <div className="btn-row">
          {t.status === 'SUSPENDED'
            ? <button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: 'reactivate' })}>Reactivate</button>
            : <button className="btn btn-danger-ghost" disabled={busy} onClick={() => act({ action: 'suspend' }, `Suspend ${t.name}? Its users are signed out and can’t sign in until you reactivate it.`)}>Suspend</button>}
        </div>
        <div className="field"><label>Notes (only Integrata sees these)</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div><button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: 'notes', notes })}>Save notes</button></div>
      </div>
    </Modal>
  );
}

function TestEmail() {
  const [state, setState] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="btn-row" style={{ marginBottom: 12 }}>
      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={async () => {
        setBusy(true); setState(undefined);
        try { const r = await api('/platform/test-email', { method: 'POST' }); setState({ kind: 'success', text: `Test email sent to ${r.to}.` }); }
        catch (e: any) { setState({ kind: 'error', text: e.message }); } finally { setBusy(false); }
      }}>{busy ? 'Sending…' : 'Send me a test email'}</button>
      {state && <Alert kind={state.kind}>{state.text}</Alert>}
    </div>
  );
}
