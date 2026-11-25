/**
 * Statutory registers for one client (the client's Registers tab): pick a register, see it, add or edit entries,
 * print it or download Excel. Registers and their fields come from the server (registers/specs.ts).
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { RecordModal, type FieldDef } from './RecordForm';
import { Alert, Empty, Spinner } from './ui';

interface Summary { code: string; title: string; short: string; law: string; form?: string; kind: 'derived' | 'entries'; count: number; open: number; warnings: number }
interface RegField { key: string; label: string; type: string; required?: boolean; help?: string; wide?: boolean; options?: { value: string; label: string }[]; when?: { key: string; in: string[] }; detailOnly?: boolean }
export interface RegisterData {
  client: { id: string; name: string; cin: string | null };
  code: string; title: string; short: string; law: string; form?: string; about: string; kind: 'derived' | 'entries';
  columns: { key: string; label: string; detailOnly?: boolean }[];
  rows: { id: string; cells: Record<string, string>; closed?: boolean; warn?: string }[];
  warnings: string[]; fields: RegField[]; raw: Record<string, Record<string, any>>;
  options: { people: { value: string; label: string }[]; members: { value: string; label: string }[] };
}

/** Register fields as RecordForm fields (one form for every record). */
export function regFormFields(d: RegisterData): FieldDef[] {
  return d.fields.map((f) => ({
    key: f.key, label: f.label, help: f.help, wide: f.wide || f.type === 'textarea', required: f.required,
    type: f.type === 'person' || f.type === 'member' ? 'select' : f.type === 'money' ? 'number' : (f.type as FieldDef['type']),
    options: f.type === 'person' ? d.options.people : f.type === 'member' ? d.options.members : f.options,
    show: f.when ? (v) => f.when!.in.includes(String(v[f.when!.key] ?? '')) : undefined,
  }));
}

export function Registers({ clientId, onRecords }: { clientId: string; onRecords?: (tab: 'Directors & KMP' | 'Shareholders') => void }) {
  const list = useLoad<Summary[]>(`/registers/${clientId}`);
  const [code, setCode] = useState('MEMBERS');
  const reg = useLoad<RegisterData>(`/registers/${clientId}/${code}`);
  const { can } = useSession();
  const [open, setOpen] = useState<string | 'new'>();
  const [all, setAll] = useState(false);
  const [note, setNote] = useState<string>();
  const reload = () => { reg.reload(); list.reload(); };
  const d = reg.data?.code === code ? reg.data : undefined;
  const editable = d?.kind === 'entries' && can('clients.manage');
  const cols = d ? d.columns.filter((c) => all || !c.detailOnly) : [];

  const save = async (v: Record<string, any>) => {
    const r = await api<{ filings: { form: string; dueDate: string; label: string }[] }>(open === 'new' ? `/registers/${clientId}/${code}/entries` : `/registers/entries/${open}`, { method: open === 'new' ? 'POST' : 'PUT', body: v });
    setNote(r.filings.length ? `Added to the calendar: ${r.filings.map((f) => `${f.form} (${f.label})`).join('; ')}.` : undefined);
    reload();
  };

  return (
    <div className="registers">
      <div className="reg-pick" role="tablist" aria-label="Registers">
        {(list.data ?? []).map((r) => (
          <button key={r.code} role="tab" aria-selected={code === r.code} className={`reg-chip ${code === r.code ? 'on' : ''}`} onClick={() => { setCode(r.code); setNote(undefined); }}>
            <b>{r.short}</b>
            <span className="muted small">{r.form ? `${r.form} · ` : ''}{r.count} {r.kind === 'derived' ? 'on record' : r.count === 1 ? 'entry' : 'entries'}{r.warnings ? <span className="due-soon"> · {r.warnings} to check</span> : null}</span>
          </button>
        ))}
      </div>
      {reg.error && <Alert kind="error">{reg.error}</Alert>}
      {!d && !reg.error && <Spinner />}
      {d && (
        <>
          <div className="toolbar" style={{ alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0 }}>{d.title}{d.form && <span className="muted"> · Form {d.form}</span>}</h3>
              <div className="muted small">[{d.law}] — {d.about}</div>
            </div>
            <span className="grow" />
            <label className="small check-inline"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All columns</label>
            <a className="btn btn-sm btn-secondary" href={`/clients/${clientId}/registers/${code}/print`} target="_blank" rel="noreferrer">Print</a>
            <a className="btn btn-sm btn-secondary" href={`/api/registers/${clientId}/export.xlsx?code=${code}`}>Excel</a>
            {editable && <button className="btn btn-sm btn-primary" onClick={() => setOpen('new')}>Add entry</button>}
          </div>
          {note && <Alert kind="success">{note}</Alert>}
          {d.kind === 'derived' && (
            <p className="small muted" style={{ marginTop: 0 }}>
              Built from the {d.code === 'MEMBERS' ? 'Shareholders' : 'Directors & KMP'} tab — edit particulars there
              {onRecords && <> (<button className="link-btn" onClick={() => onRecords(d.code === 'MEMBERS' ? 'Shareholders' : 'Directors & KMP')}>open it</button>)</>}.
              {d.code === 'MEMBERS' && ' Allotments and transfers are entered in the Allotments & transfers register.'}
            </p>
          )}
          {!!d.warnings.length && (
            <Alert kind="warning"><b>To check before printing:</b><ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{d.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}</ul>{d.warnings.length > 8 && <span className="small">…and {d.warnings.length - 8} more</span>}</Alert>
          )}
          {!d.rows.length ? <Empty>{d.kind === 'entries' ? 'No entries yet.' : 'Nothing on record yet.'}</Empty> : (
            <div className="table-wrap"><table className="table compact reg-table">
              <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.id} className={r.closed ? 'reg-closed' : ''} onClick={() => editable && setOpen(r.id)} title={r.warn} style={{ cursor: editable ? 'pointer' : 'default' }}>
                  {cols.map((c, i) => <td key={c.key}>{r.cells[c.key]}{i === 1 && r.warn && <span className="overdue small block">⚠ {r.warn}</span>}</td>)}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {open && d && (
        <RecordModal title={`${open === 'new' ? 'Add to' : 'Edit'} — ${d.short}`} fields={regFormFields(d)}
          initial={open === 'new' ? Object.fromEntries(d.fields.filter((f) => f.type === 'select' && f.required && f.options).map((f) => [f.key, f.options![0].value])) : d.raw[open] ?? {}}
          extra={<p className="muted small" style={{ marginTop: 0 }}>{d.about}</p>}
          onSave={save}
          danger={open === 'new' ? undefined : { label: 'Delete entry', onClick: async () => { await api(`/registers/entries/${open}`, { method: 'DELETE' }); reload(); } }}
          onClose={() => setOpen(undefined)} />
      )}
    </div>
  );
}
