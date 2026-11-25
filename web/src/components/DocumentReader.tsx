/**
 * Read a document into a form: pick the kind, drop the file, AI reads it, a person checks the highlighted values,
 * then it is saved through the normal APIs (services/extract.ts). One component for every entry point:
 * Clients (new client), a client's page (update), a filing (challan), and DSC files (read directly, no AI).
 */
import { useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { useLoad } from '../lib/hooks';
import type { Auditor, Client, Meta, Person, Shareholder, Year } from '../lib/types';
import { DESIGNATION, addDays, fmtDate, fyLabel, money, num } from '../lib/format';
import { Alert, Modal, Spinner } from './ui';
import { Fields, useRecordForm } from './RecordForm';
import { auditorFields, clientFields, clientToForm, formToClient } from './ClientForms';
import { DropZone } from './DropZone';

export type DocKind = 'MCA_MASTER' | 'INCORPORATION' | 'SRN_CHALLAN' | 'MGT7' | 'FINANCIALS' | 'AUDITOR' | 'BOARD_PAPERS';
interface Types { enabled: boolean; types: { key: DocKind; label: string; hint: string }[] }
interface Read { id: string; docType: DocKind; fileName: string; values: any; check: Record<string, string>; warnings: string[] }
export interface Existing { client: Client; people: Person[]; shareholders: Shareholder[]; auditors: Auditor[]; years: Year[] }

/** Whether reading documents is switched on for this deployment (an AI key is set). */
export const useReading = () => useLoad<Types>('/extract/types').data;

/** `check` keys under a prefix, without it ("client.cin" → "cin"). */
const under = (m: Record<string, string> | undefined, prefix: string) =>
  Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => k.startsWith(`${prefix}.`)).map(([k, v]) => [k.slice(prefix.length + 1), v]));

export function ReadDocument({ kinds, clientId, obligationId, existing, meta, title, onClose, onDone }: {
  kinds: DocKind[]; clientId?: string; obligationId?: string; existing?: Existing; meta: Meta; title?: string;
  onClose: () => void; onDone: (out: any) => void;
}) {
  const types = useReading();
  const [kind, setKind] = useState<DocKind>(kinds[0]);
  const [read, setRead] = useState<Read>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const def = types?.types.find((t) => t.key === kind);
  const send = async ([f]: File[]) => {
    if (f.size > 15 * 1024 * 1024) return setErr(`${f.name} is larger than 15 MB`);
    setBusy(true); setErr(undefined);
    try {
      const fd = new FormData(); fd.append('docType', kind); if (clientId) fd.append('clientId', clientId); if (obligationId) fd.append('obligationId', obligationId); fd.append('file', f);
      setRead(await api<Read>('/extract', { body: fd }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const done = (out: any) => { onDone(out); onClose(); };
  return (
    <Modal title={title ?? (read ? `Check what was read — ${def?.label}` : 'Read a document')} wide onClose={onClose}>
      {!types ? <Spinner /> : !read ? (
        <div className="stack" style={{ gap: 12 }}>
          {kinds.length > 1 && <div className="doc-pick" role="radiogroup">{kinds.map((k) => { const t = types.types.find((x) => x.key === k)!; return (
            <label key={k} className={k === kind ? 'on' : ''}><input type="radio" checked={k === kind} onChange={() => setKind(k)} /><span><strong>{t.label}</strong><span className="muted small block">{t.hint}</span></span></label>
          ); })}</div>}
          {kinds.length === 1 && def && <p className="muted small" style={{ margin: 0 }}>{def.hint}</p>}
          {err && <Alert kind="error">{err}</Alert>}
          <DropZone onFiles={send} accept=".pdf,.png,.jpg,.jpeg,.webp" busy={busy && <span><span className="spinner" style={{ display: 'inline-block', width: 14, height: 14, verticalAlign: 'middle', marginInlineEnd: 6 }} />Reading the document… this takes a few seconds</span>}>PDF or a photo / screenshot · up to 15 MB</DropZone>
          <p className="muted small" style={{ margin: 0 }}>Nothing is saved until you check the values and press Save. The document is kept with the record it fills in.</p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <p className="muted small" style={{ margin: 0 }}>Read from <strong>{read.fileName}</strong>. Values to check are <span className="field-check" style={{ background: '#fffbeb', border: '1px solid #e0a100', borderRadius: 4, padding: '0 4px' }}>highlighted</span>.</p>
          {read.warnings.map((w) => <Alert key={w} kind="warning">{w}</Alert>)}
          {(read.docType === 'MCA_MASTER' || read.docType === 'INCORPORATION') && <CompanyReview read={read} existing={existing} meta={meta} onDone={done} onCancel={onClose} />}
          {read.docType === 'BOARD_PAPERS' && existing && <BoardPapersReview read={read} existing={existing} meta={meta} onDone={done} onCancel={onClose} />}
          {read.docType === 'MGT7' && existing && <Mgt7Review read={read} existing={existing} meta={meta} onDone={done} onCancel={onClose} />}
          {read.docType === 'FINANCIALS' && existing && <FinancialsReview read={read} existing={existing} meta={meta} onDone={done} onCancel={onClose} />}
          {read.docType === 'AUDITOR' && existing && <AuditorReview read={read} existing={existing} onDone={done} onCancel={onClose} />}
          {read.docType === 'SRN_CHALLAN' && obligationId && <ChallanReview read={read} obligationId={obligationId} onDone={done} onCancel={onClose} />}
        </div>
      )}
    </Modal>
  );
}

// ---- Shared review pieces -----------------------------------------------------------------------------------

type Row = Record<string, any> & { _on: boolean; _note?: string };
type Col = { key: string; label: string; type?: 'text' | 'date' | 'number' | 'select'; options?: { value: string; label: string }[]; width?: number };
/** Editable rows with an include tick. `check` uses the row's position as read; `errors` its position among the ticked rows (as sent). */
function RowsTable({ cols, rows, setRows, prefix, check, errors }: { cols: Col[]; rows: Row[]; setRows: (r: Row[]) => void; prefix: string; check: Record<string, string>; errors: Record<string, string> }) {
  const set = (i: number, k: string, v: any) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  let sent = -1;
  return (
    <div className="table-wrap"><table className="table compact read-table">
      <thead><tr><th style={{ width: 28 }} />{cols.map((c) => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => {
        if (r._on) sent++;
        const j = sent;
        return (
          <tr key={i} className={r._on ? '' : 'off'}>
            <td><input type="checkbox" checked={r._on} onChange={(e) => set(i, '_on', e.target.checked)} aria-label="Include" /></td>
            {cols.map((c, ci) => {
              const e = r._on ? errors[`${prefix}.${j}.${c.key}`] : undefined;
              const chk = !e && check[`${prefix}.${i}.${c.key}`];
              const cls = chk ? 'needs-check' : '';
              return (
                <td key={c.key} className={e ? 'has-error' : ''}>
                  {c.type === 'select'
                    ? <select className={cls} value={r[c.key] ?? ''} onChange={(ev) => set(i, c.key, ev.target.value)}>{c.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    : <input className={cls} type={c.type ?? 'text'} value={r[c.key] ?? ''} onChange={(ev) => set(i, c.key, ev.target.value)} />}
                  {e && <span className="field-error">{e}</span>}
                  {chk && <span className="field-check">{chk}</span>}
                  {ci === 0 && r._note && <span className="muted small block">{r._note}</span>}
                </td>
              );
            })}
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}
const strip = (rows: Row[]) => rows.filter((r) => r._on).map(({ _on, _note, ...r }) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === '' ? null : v])));

type Change = { key: string; label: string; was: ReactNode; now: ReactNode; value: any; why?: ReactNode };
/** "On file → in the document" lines with a tick each. */
function ChangeList({ items, on, setOn }: { items: Change[]; on: Record<string, boolean>; setOn: (m: Record<string, boolean>) => void }) {
  if (!items.length) return <p className="muted small" style={{ margin: 0 }}>Everything here already matches what’s on file.</p>;
  return (
    <table className="table compact changes"><thead><tr><th style={{ width: 28 }} /><th>Field</th><th>On file</th><th>In the document</th></tr></thead>
      <tbody>{items.map((c) => (
        <tr key={c.key}><td><input type="checkbox" checked={!!on[c.key]} onChange={(e) => setOn({ ...on, [c.key]: e.target.checked })} aria-label={`Update ${c.label}`} /></td>
          <td><strong>{c.label}</strong>{c.why && <span className="muted small block">{c.why}</span>}</td>
          <td className={on[c.key] ? 'was' : ''}>{c.was || <span className="muted">—</span>}</td><td>{c.now}</td></tr>
      ))}</tbody>
    </table>
  );
}
const changedOn = (items: Change[], on: Record<string, boolean>) => Object.fromEntries(items.filter((c) => on[c.key]).map((c) => [c.key, c.value]));

function useSave(onDone: (o: any) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (fn: () => Promise<any>) => {
    setBusy(true); setError(undefined); setErrors({});
    try { onDone(await fn()); } catch (e: any) { setError(e.message); if (e instanceof ApiError && e.details) setErrors(e.details); } finally { setBusy(false); }
  };
  return { busy, error, errors, save };
}
const Actions = ({ busy, error, label, onSave, onCancel }: { busy: boolean; error?: string; label: string; onSave: () => void; onCancel: () => void }) => (
  <>
    {error && <Alert kind="error">{error}</Alert>}
    <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
      <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : label}</button>
    </div>
  </>
);

const personCols = (meta: Meta): Col[] => [
  { key: 'name', label: 'Name' },
  { key: 'designation', label: 'Designation', type: 'select', width: 170, options: meta.designations.map((d) => ({ value: d, label: DESIGNATION[d] ?? d })) },
  { key: 'din', label: 'DIN', width: 110 },
  { key: 'appointedOn', label: 'Appointed on', type: 'date', width: 150 },
];
/** Directors read from a document; the ones already on file (same DIN) are shown but not ticked. */
const peopleRows = (list: any[], have: Person[] = []): Row[] => list.map((d) => {
  const on = have.find((h) => (d.din && h.din === d.din) || (!d.din && h.name.toLowerCase() === d.name.toLowerCase()));
  return { ...d, _on: !on, _note: on ? 'Already on file' : undefined };
});

// ---- Per document -------------------------------------------------------------------------------------------

const COMPANY_FIELDS: [string, string, (v: any) => ReactNode][] = [
  ['name', 'Company name', (v) => v], ['incorporationDate', 'Incorporation date', fmtDate], ['rocOffice', 'RoC', (v) => v],
  ['registeredOffice', 'Registered office', (v) => v], ['email', 'Company email', (v) => v],
  ['authorisedCapital', 'Authorised capital', money], ['paidUpCapital', 'Paid-up capital', money],
];

function CompanyReview({ read, existing, meta, onDone, onCancel }: { read: Read; existing?: Existing; meta: Meta; onDone: (o: any) => void; onCancel: () => void }) {
  const form = useRecordForm(clientToForm({ ...read.values.client, flags: {}, ownerId: null }));
  const [rows, setRows] = useState<Row[]>(peopleRows(read.values.directors, existing?.people));
  const s = useSave(onDone);
  const c = existing?.client;
  const items: Change[] = c ? COMPANY_FIELDS.filter(([k]) => read.values.client[k] && String(read.values.client[k]) !== String((c as any)[k] ?? '').replace(/\.0+$/, ''))
    .map(([k, label, show]) => ({ key: k, label, was: (c as any)[k] ? show((c as any)[k]) : null, now: show(read.values.client[k]), value: read.values.client[k], why: read.check[`client.${k}`] })) : [];
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(items.map((i) => [i.key, true])));
  const directors = <>
    <h4 style={{ margin: '6px 0 0' }}>Directors and KMP</h4>
    {rows.length ? <RowsTable cols={personCols(meta)} rows={rows} setRows={setRows} prefix="directors" check={read.check} errors={s.errors} /> : <p className="muted small" style={{ margin: 0 }}>None listed in this document.</p>}
  </>;
  if (!c) return (
    <>
      <Fields fields={clientFields(meta)} form={{ ...form, errors: under(s.errors, 'client') }} check={under(read.check, 'client')} />
      {directors}
      <Actions busy={s.busy} error={s.error} label={`Add client${rows.some((r) => r._on) ? ` and ${rows.filter((r) => r._on).length} people` : ''}`} onCancel={onCancel}
        onSave={() => s.save(() => api(`/extract/${read.id}/apply`, { body: { client: formToClient(form.values), directors: strip(rows) } }))} />
    </>
  );
  return (
    <>
      <h4 style={{ margin: 0 }}>Company details</h4>
      <ChangeList items={items} on={on} setOn={setOn} />
      {directors}
      <Actions busy={s.busy} error={s.error} label="Save" onCancel={onCancel}
        onSave={() => s.save(() => api(`/extract/${read.id}/apply`, { body: { clientId: c.id, client: changedOn(items, on), directors: strip(rows) } }))} />
    </>
  );
}

function Mgt7Review({ read, existing, meta, onDone, onCancel }: { read: Read; existing: Existing; meta: Meta; onDone: (o: any) => void; onCancel: () => void }) {
  const v = read.values;
  const [fy, setFy] = useState<number | ''>(v.fy ?? '');
  const [agm, setAgm] = useState<boolean>(!!v.agmDate);
  const [holders, setHolders] = useState<Row[]>(v.shareholders.map((x: any) => ({ ...x, _on: true })));
  const [replace, setReplace] = useState(existing.shareholders.length > 0);
  const [people, setPeople] = useState<Row[]>(peopleRows(v.directors, existing.people));
  const auditorOnFile = v.auditor && existing.auditors.some((a) => (v.auditor.frn && a.frn === v.auditor.frn) || a.firmName.toLowerCase().replace(/[^a-z]/g, '').startsWith(v.auditor.firmName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8)));
  const [aud, setAud] = useState<boolean>(!!v.auditor && !auditorOnFile);
  const s = useSave(onDone);
  const had = existing.shareholders.reduce((t, x) => t + x.shares, 0);
  const onFileAgm = typeof fy === 'number' ? existing.years.find((y) => y.fy === fy)?.agmDate : null;
  return (
    <>
      <div className="field-grid">
        <div className={`field ${read.check.fy ? 'needs-check' : ''} ${s.errors.fy ? 'has-error' : ''}`}><label htmlFor="fy">Annual return for</label>
          <select id="fy" value={fy} onChange={(e) => setFy(e.target.value ? Number(e.target.value) : '')}><option value="">—</option>{[0, 1, 2, 3, 4].map((k) => { const y = new Date().getFullYear() - k; return <option key={y} value={y}>{fyLabel(y)}</option>; })}</select>
          {read.check.fy && <span className="field-check">{read.check.fy}</span>}{s.errors.fy && <span className="field-error">{s.errors.fy}</span>}</div>
        {v.agmDate && <label className="check-item field-wide"><input type="checkbox" checked={agm} onChange={(e) => setAgm(e.target.checked)} />
          <span><strong>AGM held on {fmtDate(v.agmDate)}</strong><span className="muted small block">{onFileAgm ? `On file: ${fmtDate(onFileAgm)}. ` : ''}Sets the AOC-4 / MGT-7 due dates for that year.</span></span></label>}
      </div>
      <h4 style={{ margin: '6px 0 0' }}>Shareholders ({num(holders.filter((h) => h._on).reduce((t, h) => t + (Number(h.shares) || 0), 0))} shares)</h4>
      <RowsTable rows={holders} setRows={setHolders} prefix="shareholders" check={read.check} errors={s.errors}
        cols={[{ key: 'name', label: 'Name' }, { key: 'pan', label: 'PAN', width: 120 }, { key: 'folio', label: 'Folio', width: 80 }, { key: 'shares', label: 'Shares', type: 'number', width: 110 }, { key: 'faceValue', label: 'Face value', type: 'number', width: 90 }]} />
      {existing.shareholders.length > 0 && <label className="check-item"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        <span>Replace the current register ({existing.shareholders.length} holders, {num(had)} shares) with this list<span className="muted small block">Untick to add these holders to the current list instead.</span></span></label>}
      <h4 style={{ margin: '6px 0 0' }}>Directors and KMP</h4>
      <RowsTable cols={personCols(meta)} rows={people} setRows={setPeople} prefix="directors" check={read.check} errors={s.errors} />
      {v.auditor && <label className="check-item"><input type="checkbox" checked={aud} onChange={(e) => setAud(e.target.checked)} disabled={!!auditorOnFile} />
        <span><strong>Auditor: {v.auditor.firmName}</strong>{v.auditor.frn && ` (FRN ${v.auditor.frn})`}<span className="muted small block">{auditorOnFile ? 'Already on file.' : 'Add as the statutory auditor.'}</span></span></label>}
      <Actions busy={s.busy} error={s.error} label="Save" onCancel={onCancel}
        onSave={() => s.save(() => api(`/extract/${read.id}/apply`, { body: { clientId: existing.client.id, fy: fy || null, agmDate: agm ? v.agmDate : null, shareholders: strip(holders).map((h) => ({ ...h, shareClass: h.shareClass ?? 'EQUITY' })), replaceShareholders: replace, directors: strip(people), auditor: aud ? v.auditor : null } }))} />
    </>
  );
}

function FinancialsReview({ read, existing, meta, onDone, onCancel }: { read: Read; existing: Existing; meta: Meta; onDone: (o: any) => void; onCancel: () => void }) {
  const v = read.values; const c = existing.client;
  const yn = (b: boolean) => (b ? 'Yes' : 'No');
  const items: Change[] = [
    ...(v.paidUpCapital && Number(v.paidUpCapital) !== Number(c.paidUpCapital) ? [{ key: 'paidUpCapital', label: 'Paid-up capital', was: c.paidUpCapital ? money(c.paidUpCapital) : null, now: money(v.paidUpCapital), value: v.paidUpCapital }] : []),
    ...(v.smallCompany !== null && v.smallCompany !== c.smallCompany ? [{ key: 'smallCompany', label: 'Small company (s.2(85))', was: yn(c.smallCompany), now: yn(v.smallCompany), value: v.smallCompany, why: v.smallReason }] : []),
    ...Object.entries(meta.flags).filter(([k]) => v.flags[k] !== !!c.flags[k]).map(([k, label]) => ({ key: `flag.${k}`, label, was: yn(!!c.flags[k]), now: yn(v.flags[k]), value: v.flags[k] })),
  ];
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(items.map((i) => [i.key, true])));
  const s = useSave(onDone);
  const pick = changedOn(items, on);
  const flags = Object.fromEntries(Object.entries(pick).filter(([k]) => k.startsWith('flag.')).map(([k, x]) => [k.slice(5), x]));
  return (
    <>
      <p className="small" style={{ margin: 0 }}>{v.fy ? `${fyLabel(v.fy)}: ` : ''}turnover <strong>{money(v.turnover)}</strong> · borrowings {money(v.borrowings)}{v.msmeDuesAmount ? <> · due to MSMEs {money(v.msmeDuesAmount)}</> : null}</p>
      <ChangeList items={items} on={on} setOn={setOn} />
      <p className="muted small" style={{ margin: 0 }}>The compliance calendar is worked out again after saving (e.g. MGT-7A and two board meetings for a small company).</p>
      <Actions busy={s.busy} error={s.error} label={items.length ? 'Save' : 'Keep the document on the client'} onCancel={onCancel}
        onSave={() => s.save(() => api(`/extract/${read.id}/apply`, { body: { clientId: c.id, paidUpCapital: pick.paidUpCapital, smallCompany: pick.smallCompany, flags: Object.keys(flags).length ? flags : undefined } }))} />
    </>
  );
}

function AuditorReview({ read, existing, onDone, onCancel }: { read: Read; existing: Existing; onDone: (o: any) => void; onCancel: () => void }) {
  const form = useRecordForm(read.values.auditor);
  const s = useSave(onDone);
  const current = existing.auditors.find((a) => a.current);
  return (
    <>
      <Fields fields={auditorFields} form={{ ...form, errors: under(s.errors, 'auditor') }} check={under(read.check, 'auditor')} />
      {current && form.values.current && <p className="muted small" style={{ margin: 0 }}>{current.firmName} will be kept as the former auditor.</p>}
      <Actions busy={s.busy} error={s.error} label="Add auditor" onCancel={onCancel}
        onSave={() => s.save(() => api(`/extract/${read.id}/apply`, { body: { clientId: existing.client.id, auditor: form.values } }))} />
    </>
  );
}

function ChallanReview({ read, obligationId, onDone, onCancel }: { read: Read; obligationId: string; onDone: (o: any) => void; onCancel: () => void }) {
  const v = read.values;
  const [srn, setSrn] = useState<string>(v.srn ?? '');
  const [filedOn, setFiledOn] = useState<string>(v.filedOn ?? '');
  const s = useSave(onDone);
  return (
    <>
      <div className="field-grid">
        <div className={`field ${read.check.srn ? 'needs-check' : ''}`}><label htmlFor="c-srn">SRN</label><input id="c-srn" className="mono" value={srn} onChange={(e) => setSrn(e.target.value.toUpperCase())} />{read.check.srn && <span className="field-check">{read.check.srn}</span>}</div>
        <div className={`field ${read.check.filedOn ? 'needs-check' : ''}`}><label htmlFor="c-fo">Filed on</label><input id="c-fo" type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} /></div>
      </div>
      <p className="small" style={{ margin: 0 }}>{v.form && <>Form <strong>{v.form}</strong> · </>}{v.companyName && <>{v.companyName} · </>}{v.amount && <>fees {money(v.amount)}</>}{v.approved && <> · <strong>approved</strong>{v.approvedOn && ` on ${fmtDate(v.approvedOn)}`}</>}</p>
      <Actions busy={s.busy} error={s.error} label="Use these details" onCancel={onCancel}
        onSave={() => s.save(async () => { await api(`/extract/${read.id}/attach`, { body: { obligationId } }); return { srn, filedOn, approved: v.approved, approvedOn: v.approvedOn }; })} />
    </>
  );
}

// ---- Board papers → event filings ------------------------------------------------------------------------

interface Proposed {
  ruleCode: string; form: string; title: string; days: number; eventDate: string | null; dueDate: string | null; summary: string; quote: string | null;
  person: { name: string; din: string | null; designation: string } | null; personAction: 'ADD' | 'CEASE' | null; personId: string | null; onCalendar: boolean;
}
const MEETING_KIND: Record<string, string> = { BOARD: 'Board meeting', AGM: 'AGM', EGM: 'EGM', CIRCULAR: 'Circular resolution' };

function BoardPapersReview({ read, existing, meta, onDone, onCancel }: { read: Read; existing: Existing; meta: Meta; onDone: (o: any) => void; onCancel: () => void }) {
  const v = read.values as { meeting: { kind: string | null; date: string | null }; events: Proposed[]; notFiled: { summary: string; reason: string | null }[] };
  const [rows, setRows] = useState(v.events.map((e) => ({ ...e, _on: !e.onCalendar, _person: !!e.personAction })));
  const s = useSave(onDone);
  const set = (i: number, patch: Record<string, any>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const name = (id: string | null) => existing.people.find((p) => p.id === id)?.name;
  let sent = -1;
  const ticked = rows.filter((r) => r._on);
  return (
    <>
      {v.meeting.date && <p className="small" style={{ margin: 0 }}><strong>{MEETING_KIND[v.meeting.kind ?? ''] ?? 'Meeting'}</strong> of {fmtDate(v.meeting.date)} · {v.events.length} event{v.events.length === 1 ? '' : 's'} needing a filing</p>}
      {rows.length > 0 && <div className="table-wrap"><table className="table compact read-table">
        <thead><tr><th style={{ width: 28 }} /><th style={{ width: 150 }}>Filing</th><th>What happened</th><th style={{ width: 160 }}>Event date</th><th style={{ width: 110 }}>Due</th></tr></thead>
        <tbody>{rows.map((r, i) => {
          if (r._on) sent++;
          const j = sent;
          const e = (k: string) => (r._on ? s.errors[`events.${j}.${k}`] : undefined);
          const chk = read.check[`events.${i}.eventDate`];
          const personErr = Object.entries(s.errors).filter(([k]) => r._on && k.startsWith(`events.${j}.person`)).map(([, x]) => x)[0];
          return (
            <tr key={i} className={r._on ? '' : 'off'}>
              <td><input type="checkbox" checked={r._on} onChange={(ev) => set(i, { _on: ev.target.checked })} aria-label={`Add ${r.form}`} /></td>
              <td><strong>{r.form}</strong><span className="muted small block">{r.title}</span>{r.onCalendar && <span className="badge sm">Already on the calendar</span>}</td>
              <td>
                <strong className="small">{r.summary}</strong>
                {r.quote && <span className="muted small block" style={{ fontStyle: 'italic' }}>“{r.quote}”</span>}
                {r.personAction === 'ADD' && r.person && <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={r._person} onChange={(ev) => set(i, { _person: ev.target.checked })} />
                  Add <strong>{r.person.name}</strong> as
                  <select style={{ width: 'auto' }} value={r.person.designation} onChange={(ev) => set(i, { person: { ...r.person!, designation: ev.target.value } })}>{meta.designations.map((d) => <option key={d} value={d}>{DESIGNATION[d] ?? d}</option>)}</select>
                  DIN <input style={{ width: 110 }} className={read.check[`events.${i}.person`] ? 'needs-check' : ''} value={r.person.din ?? ''} onChange={(ev) => set(i, { person: { ...r.person!, din: ev.target.value } })} />
                </label>}
                {r.personAction === 'CEASE' && <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={r._person} onChange={(ev) => set(i, { _person: ev.target.checked })} />
                  Mark <strong>{name(r.personId)}</strong> as ceased on {fmtDate(r.eventDate)}
                </label>}
                {!r.personAction && r.personId && <span className="muted small block">Linked to {name(r.personId)}</span>}
                {read.check[`events.${i}.person`] && r.personAction !== 'ADD' && <span className="field-check">{read.check[`events.${i}.person`]}</span>}
                {personErr && <span className="field-error">{personErr}</span>}
              </td>
              <td className={e('eventDate') ? 'has-error' : ''}><input type="date" className={chk ? 'needs-check' : ''} value={r.eventDate ?? ''} onChange={(ev) => set(i, { eventDate: ev.target.value || null })} />
                {chk && !e('eventDate') && <span className="field-check">{chk}</span>}{e('eventDate') && <span className="field-error">{e('eventDate')}</span>}</td>
              <td className="small">{r.eventDate ? <>{fmtDate(addDays(r.eventDate, r.days))}<span className="muted block">{r.days} days</span></> : '—'}</td>
            </tr>
          );
        })}</tbody>
      </table></div>}
      {v.notFiled.length > 0 && <div className="small"><strong>No filing needed</strong>
        <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{v.notFiled.map((x, i) => <li key={i}>{x.summary}{x.reason && <span className="muted"> — {x.reason}</span>}</li>)}</ul></div>}
      <p className="muted small" style={{ margin: 0 }}>Each ticked filing goes on the calendar with its due date and starts at “To do”. The minutes are kept in the client’s Documents.</p>
      <Actions busy={s.busy} error={s.error} label={ticked.length ? `Add ${ticked.length} filing${ticked.length === 1 ? '' : 's'} to the calendar` : 'Nothing ticked'} onCancel={onCancel}
        onSave={() => s.save(() => api(`/extract/${read.id}/apply`, { body: { clientId: existing.client.id, events: ticked.map(({ _on, _person, ...r }) => ({ ...r, personAction: _person ? r.personAction : null })) } }))} />
    </>
  );
}

// ---- DSC certificate files (no AI) --------------------------------------------------------------------------

interface DscRead { file: string; holder?: string | null; issuer?: string | null; validTo?: string | null; personId?: string | null; currentExpiry?: string | null; error?: string }
export function DscReader({ clientId, people, onClose, onDone }: { clientId: string; people: Person[]; onClose: () => void; onDone: () => void }) {
  const [list, setList] = useState<(DscRead & { on: boolean })[]>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const active = people.filter((p) => !p.ceasedOn);
  const send = async (files: File[]) => {
    setBusy(true); setErr(undefined);
    try {
      const fd = new FormData(); fd.append('clientId', clientId); for (const f of files) fd.append('files', f);
      const r = await api<DscRead[]>('/extract/dsc', { body: fd });
      setList(r.map((x) => ({ ...x, on: !x.error && !!x.personId && x.validTo !== x.currentExpiry })));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setErr(undefined);
    try { await api('/extract/dsc/apply', { body: { clientId, updates: list!.filter((x) => x.on && x.personId && x.validTo).map((x) => ({ personId: x.personId, dscExpiry: x.validTo })) } }); onDone(); onClose(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Read DSC expiry from certificate files" wide onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        {err && <Alert kind="error">{err}</Alert>}
        {!list ? <>
          <p className="muted small" style={{ margin: 0 }}>Export each director’s certificate from the DSC token (the <span className="mono">.cer</span> file — never the private key) and drop them here. The holder name and expiry date are read straight from the certificate.</p>
          <DropZone multiple onFiles={send} accept=".cer,.crt,.pem,.der" busy={busy && 'Reading…'}>.cer / .crt / .pem files</DropZone>
        </> : <>
          <div className="table-wrap"><table className="table compact read-table">
            <thead><tr><th style={{ width: 28 }} /><th>Certificate</th><th>Valid till</th><th>Director</th><th>On file</th></tr></thead>
            <tbody>{list.map((x, i) => (
              <tr key={i} className={x.on ? '' : 'off'}>
                <td><input type="checkbox" checked={x.on} disabled={!!x.error} onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} aria-label="Update" /></td>
                <td>{x.error ? <><span className="mono small">{x.file}</span><span className="field-error">{x.error}</span></> : <><strong>{x.holder}</strong><span className="muted small block">{x.file}{x.issuer && ` · ${x.issuer}`}</span></>}</td>
                <td>{fmtDate(x.validTo ?? null)}</td>
                <td>{!x.error && <select className={x.personId ? '' : 'needs-check'} value={x.personId ?? ''} onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, personId: e.target.value || null, on: !!e.target.value } : y)))}>
                  <option value="">— pick —</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</td>
                <td className="small">{fmtDate(active.find((p) => p.id === x.personId)?.dscExpiry ?? null)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !list.some((x) => x.on && x.personId)} onClick={save}>Update {list.filter((x) => x.on && x.personId).length} DSC expiry date(s)</button>
          </div>
        </>}
      </div>
    </Modal>
  );
}
