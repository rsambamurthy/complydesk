/** Firm settings: the filing workflow and the daily reminder email (with a preview of today's). */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/hooks';
import { Alert, Spinner } from '../../components/ui';
import { Fields, useRecordForm } from '../../components/RecordForm';
import { useSession } from '../../lib/session';
import { fmtDate } from '../../lib/format';

interface S { reminderDays: number[]; reminderOverdue: boolean; reminderClientUsers: boolean; requireReview: boolean; requireClientApproval: boolean }
interface Item { group: string; text: string; date: string; link: string }
const GROUP: Record<string, string> = { overdue: 'Overdue', review: 'Waiting for your review', approval: 'Waiting for your approval', due: 'Coming up', minutes: 'Minutes to sign', dsc: 'DSC expiring' };

export function Settings() {
  const { data, error, reload } = useLoad<S>('/admin/settings');
  const { can } = useSession();
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!data) return <Spinner />;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p className="muted">How filings move through your firm, and the daily reminder email.</p></div></div>
      <SettingsForm s={data} edit={can('tenant.settings')} onSaved={reload} />
      <Preview />
    </div>
  );
}

function SettingsForm({ s, edit, onSaved }: { s: S; edit: boolean; onSaved: () => void }) {
  const form = useRecordForm({ ...s, reminderDays: s.reminderDays.join(', ') });
  const [ok, setOk] = useState(false);
  return (
    <section className="card pad stack">
      <h3 style={{ margin: 0 }}>Filing workflow</h3>
      <p className="muted small" style={{ margin: 0 }}>To do → Collecting data → Drafted → {form.values.requireReview && 'With reviewer → '}{form.values.requireClientApproval && 'With client → '}Ready to file → Filed (SRN) → Approved by MCA</p>
      <fieldset disabled={!edit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <Fields form={form} fields={[
          { key: 'requireReview', label: 'A reviewer checks every filing before it is filed (maker-checker)', type: 'checkbox', wide: true, help: 'Reviewers are Partners and Firm Admins; whoever drafted a filing can’t approve it.' },
          { key: 'requireClientApproval', label: 'The client approves every filing before it is filed', type: 'checkbox', wide: true, help: 'The client’s Client Admin approves from their login — or your team records an approval received by email.' },
        ]} />
        <h3 style={{ margin: '10px 0 0' }}>Daily reminder email (08:30)</h3>
        <Fields form={form} fields={[
          { key: 'reminderDays', label: 'Remind this many days before the due date', help: 'Comma-separated, e.g. 15, 7, 1. Use 0 for “due today”.' },
          { key: 'reminderOverdue', label: 'Include overdue items every day until they’re done', type: 'checkbox', wide: true },
          { key: 'reminderClientUsers', label: 'Also email client users about their own company', type: 'checkbox', wide: true, help: 'Filings waiting for a client’s approval are always sent to that client’s approver.' },
        ]} />
      </fieldset>
      {form.error && <Alert kind="error">{form.error}</Alert>}
      {ok && <Alert kind="success">Saved.</Alert>}
      {edit && <div><button className="btn btn-primary" disabled={form.busy} onClick={() => form.submit(async (v) => {
        const days = String(v.reminderDays ?? '').split(/[,\s]+/).filter(Boolean).map(Number);
        if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 90)) throw new Error('Days must be whole numbers from 0 to 90');
        await api('/admin/settings', { method: 'PUT', body: { reminderDays: days, reminderOverdue: !!v.reminderOverdue, reminderClientUsers: !!v.reminderClientUsers, requireReview: !!v.requireReview, requireClientApproval: !!v.requireClientApproval } });
        setOk(true); onSaved();
      })}>Save settings</button></div>}
    </section>
  );
}

function Preview() {
  const { data, error } = useLoad<Item[]>('/admin/reminders/preview');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string }>();
  return (
    <section className="card pad stack">
      <div className="toolbar" style={{ padding: 0 }}><h3 style={{ margin: 0 }}>Your reminder email today</h3><span className="grow" />
        <button className="btn btn-secondary btn-sm" disabled={!data?.length} onClick={async () => {
          setMsg(undefined);
          try { const r = await api('/admin/reminders/send-me', { method: 'POST' }); setMsg({ kind: 'success', text: `Sent ${r.items} item(s) to ${r.to}.` }); }
          catch (e: any) { setMsg({ kind: 'error', text: e.message }); }
        }}>Send it to me now</button></div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!data ? <Spinner /> : data.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing for you today — no email would be sent.</p> : (
        Object.entries(GROUP).filter(([g]) => data.some((i) => i.group === g)).map(([g, l]) => (
          <div key={g}><strong className={g === 'overdue' ? 'overdue' : ''}>{l}</strong>
            <ul style={{ margin: '4px 0 8px', paddingInlineStart: 18 }}>{data.filter((i) => i.group === g).map((i, n) => <li key={n} className="small">{i.text}</li>)}</ul></div>
        ))
      )}
      <p className="muted small" style={{ margin: 0 }}>Each person gets one email a day, only when something is due, overdue or waiting for them. Anyone can turn theirs off under Users (“Daily reminder email”). Checked {fmtDate(new Date().toISOString().slice(0, 10))}.</p>
    </section>
  );
}
