/**
 * AOC-4 XBRL: the instance document ComplyDesk prepares from the statements, the XBRL details and the records —
 * what MCA's business rules still want, what the document covers, and the download.
 */
import { useLoad } from '../lib/hooks';
import { Alert, Spinner } from './ui';

interface Report {
  fileName: string; facts: number; fixes: number; bytes: number;
  issues: { level: 'fix' | 'look'; section: string; text: string }[];
  coverage: { section: string; status: 'done' | 'partial' | 'todo'; note: string }[];
}
const STATUS = { done: ['Included', 'badge-approved'], partial: ['Partly', 'badge-under_review'], todo: ['Not yet', 'badge-auto'] } as const;

export function XbrlPanel({ obligationId, version }: { obligationId: string; version: number }) {
  const { data: r, error } = useLoad<Report>(`/obligations/${obligationId}/xbrl?v=${version}`);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!r) return <Spinner />;
  const fixes = r.issues.filter((i) => i.level === 'fix'); const looks = r.issues.filter((i) => i.level === 'look');
  return (
    <section className="card pad" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }} className="grow">XBRL instance document</h3>
        <span className="small muted">{r.facts} facts · C&amp;I taxonomy 2016</span>
        <a className={`btn btn-sm ${fixes.length ? 'btn-secondary' : 'btn-primary'}`} href={`/api/obligations/${obligationId}/xbrl.xml`}>Download XML{fixes.length ? ` (${fixes.length} to fix)` : ''}</a>
      </div>
      <p className="muted small" style={{ margin: '6px 0 10px' }}>
        Prepared from the financial statements read on this filing, the XBRL details below and the client's records. Check it with MCA's XBRL validation tool (it also makes the human-readable PDF) before attaching it to the form. Save values below to refresh.
      </p>
      {fixes.length > 0 && <Alert kind="error"><strong>Needed before filing</strong><ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{fixes.map((i) => <li key={i.text}>{i.text} <span className="muted small">{i.section}</span></li>)}</ul></Alert>}
      {looks.length > 0 && <Alert kind="warning"><strong>Worth a look</strong><ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{looks.map((i) => <li key={i.text}>{i.text}</li>)}</ul></Alert>}
      {!r.issues.length && <Alert kind="success">MCA's business rules checked here are all met.</Alert>}
      <h4 style={{ margin: '12px 0 4px' }}>What the document covers</h4>
      <div className="table-wrap"><table className="table compact">
        <tbody>{r.coverage.map((c) => (
          <tr key={c.section}><td style={{ width: 120 }}><span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span></td><td><strong>{c.section}</strong>{c.note && <div className="small muted">{c.note}</div>}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>Sections marked “Not yet” are notes MCA expects in a complete filing; tag them in your XBRL tool by importing this file, or add them to the file before filing.</p>
    </section>
  );
}
