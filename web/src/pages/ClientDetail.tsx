import { Fragment, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad, useMeta } from '../lib/hooks';
import type { Auditor, Client, Meta, Obligation, Person, Shareholder, Summary, Year } from '../lib/types';
import { COMPANY_TYPE, DESIGNATION, daysFrom, fmtDate, fyLabel, money, num } from '../lib/format';
import { Alert, Empty, Spinner } from '../components/ui';
import { RecordModal, type FieldDef } from '../components/RecordForm';
import { auditorFields, clientFields, clientToForm, formToClient, personFields, shareholderFields } from '../components/ClientForms';
import { EventModal, ObligationTable } from '../components/Obligations';
import { TabStrip } from '../components/TabStrip';
import { useSession } from '../lib/session';

interface Detail { client: Client; people: Person[]; shareholders: Shareholder[]; auditors: Auditor[]; years: Year[]; summary: Summary; rules: { code: string; form: string; title: string; applies: boolean }[] }

const TABS = ['Compliance', 'Directors & KMP', 'Shareholders', 'Auditor', 'Details'] as const;

export function ClientDetail() {
  const { id } = useParams();
  const { data, error, reload } = useLoad<Detail>(`/clients/${id}`);
  const meta = useMeta();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Compliance');
  const [editing, setEditing] = useState(false);
  const { can } = useSession();
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!data || !meta) return <Spinner />;
  const { client: c } = data;
  const active = data.people.filter((p) => !p.ceasedOn);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{c.name}</h1>
          <p className="muted"><span className="mono">{c.cin}</span> · {COMPANY_TYPE[c.companyType]}{c.smallCompany && ' · Small company'}{c.incorporationDate && ` · Incorporated ${fmtDate(c.incorporationDate)}`}</p>
        </div>
        {can('clients.manage') && <div className="head-actions"><button className="btn btn-secondary" onClick={() => setEditing(true)}>Edit details</button></div>}
      </div>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="card tile"><span className={`tile-n ${data.summary.overdue ? 'tile-bad' : ''}`}>{data.summary.overdue}</span><span className="tile-l">Overdue</span></div>
        <div className="card tile"><span className="tile-n">{data.summary.month}</span><span className="tile-l">Due in 30 days</span></div>
        <div className="card tile"><span className="tile-n">{active.filter((p) => p.designation.includes('DIRECTOR')).length}</span><span className="tile-l">Directors</span></div>
        <div className="card tile"><span className="tile-n">{num(data.shareholders.reduce((s, x) => s + x.shares, 0))}</span><span className="tile-l">Shares held ({data.shareholders.length} holders)</span></div>
      </div>
      <section className="card">
        <TabStrip>{TABS.map((t) => <button key={t} role="tab" className={tab === t ? 'active' : ''} aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</TabStrip>
        <div className="tab-panel">
          {tab === 'Compliance' && <ComplianceTab d={data} meta={meta} reload={reload} />}
          {tab === 'Directors & KMP' && (
            <ChildList title="Directors & KMP" path="people" clientId={c.id} rows={data.people} fields={personFields(meta)} reload={reload}
              initial={{ designation: 'DIRECTOR' }}
              cols={[
                { label: 'Name', cell: (p) => <><strong>{p.name}</strong>{p.ceasedOn && <span className="badge sm">Ceased {fmtDate(p.ceasedOn)}</span>}<span className="muted small block">{p.email}</span></> },
                { label: 'Designation', cell: (p) => DESIGNATION[p.designation] ?? p.designation },
                { label: 'DIN / PAN', cell: (p) => <span className="mono small">{p.din ?? '—'}<span className="block">{p.pan ?? ''}</span></span> },
                { label: 'Appointed', cell: (p) => fmtDate(p.appointedOn) },
                { label: 'DSC expiry', cell: (p) => <DscExpiry date={p.dscExpiry} /> },
                { label: 'Last KYC', cell: (p) => (p.kycLastFiledFy ? fyLabel(p.kycLastFiledFy) : p.designation.includes('DIRECTOR') ? <span className="muted">—</span> : '') },
              ]} />
          )}
          {tab === 'Shareholders' && <Shareholders d={data} reload={reload} />}
          {tab === 'Auditor' && (
            <ChildList title="Statutory auditor" path="auditors" clientId={c.id} rows={data.auditors} fields={auditorFields} reload={reload} initial={{ current: true }}
              cols={[
                { label: 'Firm', cell: (a) => <><strong>{a.firmName}</strong>{!a.current && <span className="badge sm">Former</span>}<span className="muted small block">{a.frn}</span></> },
                { label: 'Appointed', cell: (a) => fmtDate(a.appointedOn) },
                { label: 'Term', cell: (a) => (a.termFromFy && a.termToFy ? `${fyLabel(a.termFromFy)} to ${fyLabel(a.termToFy)}` : '—') },
              ]} />
          )}
          {tab === 'Details' && (
            <dl className="kv pad">
              <dt>Registered office</dt><dd>{c.registeredOffice ?? '—'}</dd>
              <dt>RoC</dt><dd>{c.rocOffice ?? '—'}</dd>
              <dt>Email</dt><dd>{c.email ?? '—'}</dd>
              <dt>Authorised capital</dt><dd>{money(c.authorisedCapital)}</dd>
              <dt>Paid-up capital</dt><dd>{money(c.paidUpCapital)}</dd>
              {Object.entries(meta.flags).map(([k, label]) => <Fragment key={k}><dt>{label}</dt><dd>{c.flags[k] ? 'Yes' : 'No'}</dd></Fragment>)}
            </dl>
          )}
        </div>
      </section>
      {editing && <RecordModal title="Edit client" fields={clientFields(meta)} initial={clientToForm(c)}
        onSave={async (v) => { await api(`/clients/${c.id}`, { method: 'PATCH', body: formToClient(v) }); reload(); }} onClose={() => setEditing(false)} />}
    </div>
  );
}

function DscExpiry({ date }: { date: string | null }) {
  if (!date) return <span className="muted">—</span>;
  const d = daysFrom(date);
  return <span className={d < 0 ? 'overdue' : d <= 30 ? 'warn-text' : ''}>{fmtDate(date)}{d < 0 ? ' (expired)' : d <= 30 ? ` (${d} days)` : ''}</span>;
}

function ComplianceTab({ d, meta, reload }: { d: Detail; meta: Meta; reload: () => void }) {
  const [view, setView] = useState<'open' | 'done' | 'all'>('open');
  const [adding, setAdding] = useState(false);
  const [year, setYear] = useState<number>();
  const list = useLoad<Obligation[]>(`/obligations?clientId=${d.client.id}&bucket=${view}`);
  const { can } = useSession();
  const refresh = () => { reload(); list.reload(); };
  // Forms none of whose rules apply (a form like AOC-4 has a private and an OPC rule: it applies if either does).
  const applying = new Set(d.rules.filter((r) => r.applies).map((r) => r.form));
  const notApplying = [...new Set(d.rules.filter((r) => !r.applies && !['BM_FIRST', 'INC20A', 'ADT1'].includes(r.code)).map((r) => r.form))].filter((f) => !applying.has(f));
  return (
    <>
      <div className="toolbar">
        <div className="seg">{(['open', 'done', 'all'] as const).map((v) => <button key={v} className={`seg-btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{v === 'open' ? 'To do' : v === 'done' ? 'Done' : 'Everything'}</button>)}</div>
        <span className="grow" />
        {can('clients.manage') && meta.fys.map((fy) => {
          const y = d.years.find((x) => x.fy === fy);
          return <button key={fy} className="btn btn-sm btn-secondary" onClick={() => setYear(fy)} title="AGM and first board meeting dates">{fyLabel(fy)}: AGM {y?.agmDate ? fmtDate(y.agmDate) : 'not recorded'}</button>;
        })}
        {can('compliance.work') && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>Add event-based filing</button>}
      </div>
      {list.data ? <ObligationTable rows={list.data} showClient={false} meta={meta} onChanged={refresh} empty={view === 'open' ? 'Nothing to do right now.' : 'Nothing here.'} /> : <Spinner />}
      {notApplying.length > 0 && <p className="muted small pad">Not applicable to this company: {notApplying.join(', ')}.</p>}
      {adding && <EventModal clientId={d.client.id} meta={meta} people={d.people} onClose={() => setAdding(false)} onSaved={refresh} />}
      {year !== undefined && (
        <RecordModal title={`${fyLabel(year)} — meeting dates`}
          extra={<p className="muted small" style={{ marginTop: 0 }}>These are filled in when the AGM or a board meeting is marked held. Due dates of AOC-4, MGT-7, ADT-1 and MBP-1 / DIR-8 follow them.</p>}
          fields={[{ key: 'agmDate', label: 'AGM held on', type: 'date' }, { key: 'firstBoardMeetingDate', label: 'First board meeting of the year', type: 'date' }]}
          initial={d.years.find((x) => x.fy === year) ?? {}}
          onSave={async (v) => { await api(`/clients/${d.client.id}/years/${year}`, { method: 'PUT', body: { agmDate: v.agmDate || null, firstBoardMeetingDate: v.firstBoardMeetingDate || null } }); refresh(); }}
          onClose={() => setYear(undefined)} />
      )}
    </>
  );
}

function Shareholders({ d, reload }: { d: Detail; reload: () => void }) {
  const total = d.shareholders.reduce((s, x) => s + x.shares, 0);
  return (
    <ChildList title="Register of members" path="shareholders" clientId={d.client.id} rows={d.shareholders} fields={shareholderFields} reload={reload} initial={{ shareClass: 'EQUITY', faceValue: '10' }}
      cols={[
        { label: 'Name', cell: (s) => <><strong>{s.name}</strong><span className="muted small block mono">{s.pan}</span></> },
        { label: 'Folio', cell: (s) => s.folio ?? '—' },
        { label: 'Class', cell: (s) => (s.shareClass === 'EQUITY' ? 'Equity' : 'Preference') },
        { label: 'Shares', num: true, cell: (s) => num(s.shares) },
        { label: 'Holding', num: true, cell: (s) => (total ? `${((s.shares / total) * 100).toFixed(2)}%` : '—') },
        { label: 'Paid-up value', num: true, cell: (s) => money(s.shares * Number(s.faceValue)) },
      ]} />
  );
}

/** A client's list of directors / shareholders / auditors with add and edit (one component for all three). */
function ChildList<T extends { id: string }>({ title, path, clientId, rows, cols, fields, initial, reload }: {
  title: string; path: string; clientId: string; rows: T[]; fields: FieldDef[]; initial: Record<string, any>; reload: () => void;
  cols: { label: string; cell: (r: T) => ReactNode; num?: boolean }[];
}) {
  const [open, setOpen] = useState<T | 'new'>();
  const { can } = useSession();
  const clean = (v: Record<string, any>) => Object.fromEntries(Object.entries(v).filter(([k]) => !['id', 'tenantId', 'clientId', 'createdAt'].includes(k)));
  return (
    <>
      <div className="toolbar"><h3>{title}</h3><span className="grow" />{can('clients.manage') && <button className="btn btn-sm btn-primary" onClick={() => setOpen('new')}>Add</button>}</div>
      {rows.length === 0 ? <Empty>None added yet.</Empty> : (
        <div className="table-wrap"><table className="table compact">
          <thead><tr>{cols.map((c) => <th key={c.label} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} onClick={() => can('clients.manage') && setOpen(r)}>{cols.map((c) => <td key={c.label} className={c.num ? 'num' : ''}>{c.cell(r)}</td>)}</tr>)}</tbody>
        </table></div>
      )}
      {open && (
        <RecordModal title={open === 'new' ? `Add — ${title}` : `Edit — ${title}`} fields={fields} initial={open === 'new' ? initial : open}
          onSave={async (v) => { await api(open === 'new' ? `/clients/${clientId}/${path}` : `/clients/${path}/${open.id}`, { method: open === 'new' ? 'POST' : 'PATCH', body: clean(v) }); reload(); }}
          danger={open === 'new' ? undefined : { label: 'Delete', onClick: async () => { await api(`/clients/${path}/${open.id}`, { method: 'DELETE' }); reload(); } }}
          onClose={() => setOpen(undefined)} />
      )}
    </>
  );
}
