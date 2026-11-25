/** The ComplyDesk Chrome extension: download, install steps, and this user's connection codes. */
import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { Alert, Empty, Spinner } from '../components/ui';

interface Conn { id: string; name: string; lastUsedAt: string | null; createdAt: string }

export function Extension() {
  const { data, error, reload } = useLoad<Conn[]>('/auth/extension-tokens');
  const [name, setName] = useState('Chrome on my laptop');
  const [code, setCode] = useState<string>();
  const [err, setErr] = useState<string>();
  const [copied, setCopied] = useState(false);
  const create = async () => {
    setErr(undefined);
    try { const r = await api<{ token: string }>('/auth/extension-tokens', { body: { name } }); setCode(r.token); setCopied(false); reload(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>MCA form filler</h1><p className="muted">A Chrome extension that fills MCA V3 web forms from ComplyDesk’s form data, next to the portal. You check, save, sign with DSC and submit on the portal as usual — it never submits.</p></div>
        <div className="head-actions"><a className="btn btn-primary" href="/api/extension.zip">Download the extension</a></div>
      </div>
      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <section className="card pad">
          <h3 style={{ marginTop: 0 }}>Install (once per computer)</h3>
          <ol className="small" style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 6 }}>
            <li>Download the extension and unzip it.</li>
            <li>In Chrome, open <span className="mono">chrome://extensions</span> and switch on <b>Developer mode</b> (top right).</li>
            <li>Click <b>Load unpacked</b> and pick the <span className="mono">complydesk-extension</span> folder.</li>
            <li>Pin it: puzzle icon → pin <b>ComplyDesk</b>.</li>
            <li>Click the ComplyDesk icon — a panel opens on the right. Paste this ComplyDesk address and a connection code from here.</li>
          </ol>
          <p className="muted small" style={{ marginBottom: 0 }}>ComplyDesk address: <span className="mono">{window.location.origin}</span></p>
        </section>
        <section className="card pad">
          <h3 style={{ marginTop: 0 }}>Using it</h3>
          <ol className="small" style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 6 }}>
            <li>Prepare the filing’s <b>MCA form data</b> in ComplyDesk (open the filing → Open … form data).</li>
            <li>On the MCA portal, open the form and enter the CIN.</li>
            <li>In the ComplyDesk panel pick the filing and press <b>Find fields on this page</b>.</li>
            <li>Check the matches (change any that are wrong), then <b>Fill</b>. Filled fields get a green outline.</li>
            <li>For anything not matched: click into the portal field, then <b>Put in selected field</b>. Tables: <b>Copy for Excel</b> into MCA’s template.</li>
          </ol>
        </section>
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="toolbar"><h3>Your connections</h3><span className="grow" />
          <input style={{ width: 240 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name of this browser" />
          <button className="btn btn-sm btn-primary" onClick={create}>Create a connection code</button></div>
        <div className="pad" style={{ paddingTop: 0 }}>
          {(error || err) && <Alert kind="error">{error ?? err}</Alert>}
          {code && <Alert kind="success">
            <strong>Copy this code into the extension now — it won’t be shown again.</strong>
            <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}><code className="mono" style={{ wordBreak: 'break-all', flex: 1 }}>{code}</code>
              <button className="btn btn-sm btn-secondary" onClick={async () => { await navigator.clipboard?.writeText(code).catch(() => {}); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button></div>
          </Alert>}
          {!data ? <Spinner /> : data.length === 0 ? <Empty>No browsers connected yet.</Empty> : (
            <table className="table compact"><thead><tr><th>Browser</th><th>Created</th><th>Last used</th><th /></tr></thead>
              <tbody>{data.map((c) => <tr key={c.id}><td>{c.name}</td><td className="small">{fmtDateTime(c.createdAt)}</td><td className="small">{c.lastUsedAt ? fmtDateTime(c.lastUsedAt) : '—'}</td>
                <td className="num"><button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (window.confirm(`Disconnect ${c.name}?`)) { await api(`/auth/extension-tokens/${c.id}`, { method: 'DELETE' }); reload(); } }}>Disconnect</button></td></tr>)}</tbody></table>
          )}
          <p className="muted small">A connection code lets that browser read form data of the clients you can see — nothing else. Disconnect a browser you no longer use.</p>
        </div>
      </section>
    </div>
  );
}
