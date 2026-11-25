/** A statutory register, printable (A4 landscape) — opens in its own tab; the browser's Print saves it as PDF. */
import { useParams } from 'react-router-dom';
import { useLoad } from '../lib/hooks';
import { Spinner, Alert } from '../components/ui';
import type { RegisterData } from '../components/Registers';

export function RegisterPrint() {
  const { id, code } = useParams();
  const { data: d, error } = useLoad<RegisterData>(`/registers/${id}/${code}`);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!d) return <Spinner />;
  return (
    <div className="reg-print">
      <style>{'body { background: #fff } @page { size: A4 landscape; margin: 12mm } @media print { .no-print { display: none } }'}</style>
      <div className="no-print" style={{ textAlign: 'right', marginBottom: 12 }}><button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print / save as PDF</button></div>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        {d.form && <div style={{ fontSize: 13 }}>Form No. {d.form}</div>}
        <h2 style={{ margin: '2px 0' }}>{d.title.toUpperCase()}</h2>
        <div style={{ fontSize: 13 }}>[Pursuant to {d.law}]</div>
        <div style={{ marginTop: 8 }}><b>{d.client.name}</b>{d.client.cin && <> · CIN {d.client.cin}</>}</div>
      </div>
      <table>
        <thead><tr>{d.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {d.rows.map((r) => <tr key={r.id}>{d.columns.map((c) => <td key={c.key}>{r.cells[c.key]}</td>)}</tr>)}
          {!d.rows.length && <tr><td colSpan={d.columns.length} style={{ textAlign: 'center' }}>No entries.</td></tr>}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 36, fontSize: 13 }}>
        <span>Place: ________</span><span>Authenticated by: ____________________ (Director / Company Secretary)</span>
      </div>
      {!!d.warnings.length && <p className="no-print muted small">To check: {d.warnings.join(' · ')}</p>}
    </div>
  );
}
