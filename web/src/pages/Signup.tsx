/** Self sign-up for a CS firm (layout and live workspace-code check as in VendorGate's sign-up). */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, lastWorkspace } from '../lib/api';
import { useSession } from '../lib/session';
import { Alert } from '../components/ui';
import { Fields, useRecordForm, type FieldDef } from '../components/RecordForm';
import { PoweredBy, Wordmark } from '../components/Brand';

const FIELDS: FieldDef[] = [
  { key: 'firmName', label: 'Firm name', required: true, wide: true, placeholder: 'e.g. Rao & Associates, Company Secretaries' },
  { key: 'workspace', label: 'Workspace code', required: true, help: 'Your team types this when they sign in.' },
  { key: 'city', label: 'City', required: true },
  { key: 'icsiNumber', label: 'ICSI membership / COP no.', placeholder: 'Optional' },
  { key: 'gstin', label: 'GSTIN', placeholder: 'Optional' },
  { key: 'adminName', label: 'Your name', required: true },
  { key: 'mobile', label: 'Mobile', required: true, placeholder: '10 digits' },
  { key: 'email', label: 'Work email', type: 'email', required: true, wide: true },
  { key: 'password', label: 'Password', type: 'password', required: true, help: 'At least 10 characters.' },
  { key: 'accept', label: 'I agree to the terms of service and may sign up on behalf of this firm.', type: 'checkbox', wide: true },
];

export function Signup() {
  const form = useRecordForm({ accept: false });
  const rawSet = form.set;
  const [codeTouched, setCodeTouched] = useState(false);
  const [codeState, setCodeState] = useState<{ available: boolean; reason?: string }>();
  const [pending, setPending] = useState<string>();
  const { refresh } = useSession();
  const nav = useNavigate();
  const { firmName, workspace } = form.values;

  // Suggest a workspace code from the firm name until the user edits it; check availability as they type.
  useEffect(() => {
    if (codeTouched || !firmName || firmName.length < 3) return;
    const t = setTimeout(() => api(`/auth/workspace-available?code=x&name=${encodeURIComponent(firmName)}`).then((r) => r.suggestion && rawSet('workspace', r.suggestion)).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [firmName, codeTouched]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!workspace) { setCodeState(undefined); return; }
    const t = setTimeout(() => api(`/auth/workspace-available?code=${encodeURIComponent(workspace)}`).then(setCodeState).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [workspace]);

  const fields = FIELDS.map((f) => f.key === 'workspace' ? { ...f, help: codeState && !codeState.available ? `✗ ${codeState.reason}` : codeState?.available ? '✓ Available. Your team types this when they sign in.' : f.help } : f);
  form.set = (k, v) => { if (k === 'workspace') { setCodeTouched(true); v = String(v ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30); } rawSet(k, v); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await form.submit(async (v) => {
      const r = await api('/auth/signup', { body: v });
      lastWorkspace.set(r.workspace);
      if (r.status === 'PENDING_APPROVAL') { setPending(r.workspace); return; }
      await refresh();
      nav('/dashboard?welcome=1', { replace: true });
    });
  }

  return (
    <div className="center-page login-bg">
      <div className="card login-card split signup-card">
        <div className="login-side">
          <span className="vg-wordmark light" style={{ fontSize: 28 }}><Wordmark light /></span>
          <h2>Every client’s MCA calendar, worked out for you</h2>
          <ul className="signup-points">
            <li>Board meetings, AGM, AOC-4, MGT-7, DIR-3 KYC, DPT-3, MSME-1 — dated per company</li>
            <li>Due dates follow the AGM and board meetings you record</li>
            <li>Event-based filings (DIR-12, PAS-3, MGT-14, CHG-1…) in one click</li>
            <li>Import all your clients from Excel</li>
          </ul>
          <p className="signup-trial">Free trial. No card needed.</p>
          <PoweredBy light />
        </div>
        <div className="login-main">
          {pending ? (
            <div className="stack">
              <h2 style={{ margin: 0 }}>Thank you — we’ve received your sign-up</h2>
              <p>Your workspace <strong className="mono">{pending}</strong> is waiting for approval by Integrata. We’ll email you as soon as it’s open, usually within one working day.</p>
              <p className="small muted">Please also confirm your email using the link we’ve sent.</p>
              <Link to="/login" className="btn btn-secondary">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="stack">
              <h2 style={{ margin: 0 }}>Create your firm’s workspace</h2>
              <p className="muted small" style={{ margin: 0 }}>Already have one? <Link to="/login">Sign in</Link></p>
              {form.error && <Alert kind="error">{form.error}</Alert>}
              <Fields fields={fields} form={form} />
              <button className="btn btn-primary btn-block" disabled={form.busy || codeState?.available === false || !form.values.accept}>{form.busy ? 'Creating…' : 'Create workspace'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function VerifyEmail() {
  const [state, setState] = useState<'busy' | 'ok' | string>('busy');
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    api('/auth/verify-email', { body: { token } }).then(() => setState('ok')).catch((e) => setState(e.message));
  }, []);
  return (
    <div className="center-page login-bg">
      <div className="card login-card" style={{ maxWidth: 460, padding: 32 }}>
        <Wordmark />
        {state === 'busy' ? <div className="spinner" /> : state === 'ok'
          ? <><h2>Email confirmed ✓</h2><p>Thank you. You can carry on in ComplyDesk.</p><Link className="btn btn-primary" to="/dashboard">Open ComplyDesk</Link></>
          : <><h2>We couldn’t confirm your email</h2><Alert kind="error">{state}</Alert><p className="small muted">Sign in and use “Resend link” on the banner to get a new one.</p><Link className="btn btn-secondary" to="/login">Sign in</Link></>}
      </div>
    </div>
  );
}
