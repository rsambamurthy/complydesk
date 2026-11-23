import { useLoad } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { Alert, Spinner } from '../../components/ui';

interface Row { a: { id: string; action: string; entity: string; entityId: string | null; data: any; at: string }; userName: string | null }

export function Audit() {
  const { data, error } = useLoad<Row[]>('/admin/audit');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Audit log</h1><p className="muted">Every change, who made it and when (latest 300).</p></div></div>
      {error && <Alert kind="error">{error}</Alert>}
      <section className="card">{!data ? <Spinner /> : (
        <div className="table-wrap"><table className="table compact static">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{data.map(({ a, userName }) => (
            <tr key={a.id}><td className="small nowrap">{fmtDateTime(a.at)}</td><td className="small">{userName ?? '—'}</td><td className="small mono">{a.action}</td>
              <td className="small muted" style={{ maxWidth: 520, wordBreak: 'break-word' }}>{a.data ? JSON.stringify(a.data) : ''}</td></tr>
          ))}</tbody>
        </table></div>
      )}</section>
    </div>
  );
}
