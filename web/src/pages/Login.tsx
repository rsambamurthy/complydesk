import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, lastWorkspace } from '../lib/api';
import { useSession } from '../lib/session';
import { Alert } from '../components/ui';
import { PoweredBy, PRODUCT } from '../components/Brand';

export function Login() {
  const [workspace, setWorkspace] = useState(lastWorkspace.get());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const nav = useNavigate();
  const [qs] = useSearchParams();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(undefined);
    try {
      await api('/auth/login', { body: { workspace, email, password } });
      lastWorkspace.set(workspace);
      await refresh();
      nav(qs.get('next') || '/dashboard');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="center-page login-bg">
      <div className="card login-card split">
        <div className="login-side">
          <span className="vg-wordmark light" style={{ fontSize: 28 }}>{PRODUCT}</span>
          <h2>Never miss an MCA due date.</h2>
          <p>Every client’s compliance calendar worked out from its own facts — meetings, annual filings, director KYC and event-based forms — in one place.</p>
          <PoweredBy light />
        </div>
        <form className="login-main stack" onSubmit={submit}>
          <h2 style={{ margin: 0 }}>Sign in</h2>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="field"><label htmlFor="ws">Workspace</label><input id="ws" value={workspace} onChange={(e) => setWorkspace(e.target.value)} autoComplete="organization" required /></div>
          <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="small muted center" style={{ margin: 0 }}>New to ComplyDesk? <Link to="/signup">Start a free trial for your firm</Link></p>
        </form>
      </div>
    </div>
  );
}
