/** One meeting: details and checks, agenda and resolutions, attendance, minutes. */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad, useMeta } from '../lib/hooks';
import { DESIGNATION, fmtDate, fyLabel, today } from '../lib/format';
import { Alert, Modal, Spinner, StatusBadge } from '../components/ui';
import { RecordModal } from '../components/RecordForm';
import { MEETING_TYPE, MODE, MeetingStatus } from '../components/Meetings';
import { useSession } from '../lib/session';
import type { ObStatus } from '../lib/types';

interface Item { id: string; seq: number; templateKey: string | null; title: string; resolutionType: string; text: string | null; personId: string | null; filings: string[]; completes: string[]; outcome: string; created: { id: string; form: string; dueDate: string; status: ObStatus }[] }
interface Detail {
  meeting: { id: string; clientId: string; type: string; fy: number; title: string; date: string; time: string | null; mode: string; venue: string | null; videoLink: string | null; status: string; noticeSentOn: string | null; shorterNotice: boolean; heldOn: string | null; chairpersonId: string | null; membersPresent: number | null; minutes: string | null; minutesSignedOn: string | null; obligationId: string | null };
  client: { id: string; name: string; cin: string; registeredOffice: string | null };
  items: Item[]; attendance: { personId: string; name: string; designation: string; din: string | null; status: string | null }[];
  people: { id: string; name: string; designation: string }[]; checks: { key: string; ok: boolean; level: string; text: string }[];
  templates: { key: string; title: string; resolutionType: string; person: boolean; filings: string[]; completes: string[] }[];
}
const RES: Record<string, string> = { NONE: 'For noting', BOARD: 'Board resolution', ORDINARY: 'Ordinary resolution', SPECIAL: 'Special resolution' };
const OUTCOMES: Record<string, string> = { PENDING: 'Not yet decided', PASSED: 'Passed', NOTED: 'Noted', NOT_PASSED: 'Not passed', DEFERRED: 'Deferred' };
const STEPS = [['SCHEDULED', 'Scheduled'], ['NOTICE_SENT', 'Notice sent'], ['HELD', 'Held'], ['MINUTES_SIGNED', 'Minutes signed']];

export function MeetingDetail() {
  const { id } = useParams();
  const { data, error, reload } = useLoad<Detail>(`/meetings/${id}`);
  const meta = useMeta();
  const { can } = useSession();
  const [dlg, setDlg] = useState<'edit' | 'notice' | 'held' | 'add' | 'sign' | Item>();
  const [err, setErr] = useState<string>();
  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!data || !meta) return <Spinner />;
  const { meeting: x, client, items } = data;
  const edit = can('compliance.work') && x.status !== 'CANCELLED';
  const signed = x.status === 'MINUTES_SIGNED';
  const stepAt = STEPS.findIndex(([s]) => s === x.status);
  const run = async (fn: () => Promise<unknown>) => { setErr(undefined); try { await fn(); reload(); } catch (e: any) { setErr(e.message); } };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{x.title}</h1>
          <p className="muted"><Link to={`/clients/${client.id}`}>{client.name}</Link> · {MEETING_TYPE[x.type]} · {fmtDate(x.heldOn ?? x.date)}{x.time && `, ${x.time}`} · {MODE[x.mode]}{x.mode !== 'VIDEO' && x.venue && ` · ${x.venue}`}</p>
        </div>
        <div className="head-actions">
          <a className="btn btn-secondary btn-sm" href={`/meetings/${x.id}/print/notice`} target="_blank" rel="noreferrer">Notice &amp; agenda</a>
          {x.minutes && <a className="btn btn-secondary btn-sm" href={`/meetings/${x.id}/print/minutes`} target="_blank" rel="noreferrer">Minutes</a>}
          {edit && !signed && <button className="btn btn-secondary btn-sm" onClick={() => setDlg('edit')}>Edit details</button>}
        </div>
      </div>
      {err && <Alert kind="error">{err}</Alert>}

      {x.status === 'CANCELLED' ? <Alert kind="warning">This meeting was cancelled.</Alert> : (
        <section className="card pad" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {STEPS.map(([s, label], i) => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className={`badge ${i < stepAt || (i === stepAt && s === 'MINUTES_SIGNED') ? 'badge-approved' : i === stepAt ? 'badge-under_review' : ''}`}>{i < stepAt || s === 'MINUTES_SIGNED' && i === stepAt ? '✓ ' : ''}{label}</span>
              {i < STEPS.length - 1 && <span className="muted">→</span>}
            </span>
          ))}
          <span className="grow" />
          {edit && x.status === 'SCHEDULED' && <button className="btn btn-primary btn-sm" onClick={() => setDlg('notice')}>Mark notice sent</button>}
          {edit && (x.status === 'SCHEDULED' || x.status === 'NOTICE_SENT') && <button className={`btn btn-sm ${x.status === 'NOTICE_SENT' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDlg('held')}>Record as held</button>}
          {edit && x.status === 'HELD' && <button className="btn btn-primary btn-sm" onClick={() => setDlg('sign')} disabled={!x.minutes}>Mark minutes signed</button>}
          {edit && !x.heldOn && <button className="btn btn-danger-ghost btn-sm" onClick={() => window.confirm('Cancel this meeting?') && run(() => api(`/meetings/${x.id}/cancel`, { method: 'POST' }))}>Cancel meeting</button>}
        </section>
      )}

      {data.checks.length > 0 && (
        <section className="card pad stack" style={{ gap: 6 }}>
          {data.checks.map((c) => <div key={c.key} className={c.level === 'ok' ? 'ok-text' : c.level === 'error' ? 'overdue' : 'warn-text'}>{c.level === 'ok' ? '✓' : c.level === 'error' ? '✗' : '!'} {c.text}</div>)}
          {x.obligationId && <div className="ok-text">✓ Ticked off on the compliance calendar ({x.type === 'AGM' ? `AGM ${fyLabel(x.fy)}` : 'board meeting for the period'}).</div>}
        </section>
      )}

      <div className="detail-grid">
        <section className="card">
          <div className="toolbar"><h3>Agenda</h3><span className="grow" />{edit && !signed && <button className="btn btn-sm btn-primary" onClick={() => setDlg('add')}>Add an item</button>}</div>
          {!x.heldOn && items.some((i) => i.filings.length) && <p className="muted small pad" style={{ paddingBlock: 0 }}>Filings shown under an item go on the calendar, dated the meeting day, once the meeting is recorded as held and the item is passed.</p>}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((i, n) => (
              <li key={i.id} style={{ padding: '12px 16px', borderTop: '1px solid var(--border, #e5e7eb)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <strong style={{ minWidth: 22 }}>{n + 1}.</strong>
                  <div style={{ flex: 1 }}>
                    <strong>{i.title}</strong> <span className="badge sm">{RES[i.resolutionType]}</span>
                    {i.text && <p className="small" style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{i.text}</p>}
                    <div className="small" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {i.filings.filter((f) => !i.created.some((c) => meta.eventRules.find((r) => r.code === f)?.form === c.form)).map((f) => <span key={f} className="chip">Creates {meta.eventRules.find((r) => r.code === f)?.form ?? f}</span>)}
                      {i.completes.length > 0 && <span className="chip">Completes {i.completes.includes('MBP1_DIR8') ? 'MBP-1 / DIR-8' : i.completes.join(', ')}</span>}
                      {i.created.map((c) => <Link key={c.id} to={`/clients/${client.id}`} className="chip">{c.form} due {fmtDate(c.dueDate)} <StatusBadge status={c.status} /></Link>)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {edit && !signed ? (
                      <select value={i.outcome} onChange={(e) => run(() => api(`/meetings/items/${i.id}`, { method: 'PATCH', body: { outcome: e.target.value } }))} aria-label="Outcome" style={{ width: 150 }}>
                        {Object.entries(OUTCOMES).filter(([k]) => i.resolutionType === 'NONE' ? k !== 'PASSED' && k !== 'NOT_PASSED' : k !== 'NOTED').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    ) : <span className="badge">{OUTCOMES[i.outcome]}</span>}
                    {edit && !signed && <>
                      <button className="icon-btn" title="Move up" disabled={n === 0} onClick={() => run(() => api(`/meetings/items/${i.id}/move`, { body: { dir: -1 } }))}>↑</button>
                      <button className="icon-btn" title="Move down" disabled={n === items.length - 1} onClick={() => run(() => api(`/meetings/items/${i.id}/move`, { body: { dir: 1 } }))}>↓</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setDlg(i)}>Edit</button>
                    </>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <Attendance d={data} edit={edit && !signed} onSaved={reload} />
      </div>

      {x.heldOn && <Minutes d={data} edit={edit} onSaved={reload} />}

      {dlg === 'edit' && <RecordModal title="Meeting details" initial={x}
        fields={[
          { key: 'title', label: 'Title', wide: true, required: true },
          { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'time', label: 'Time' },
          { key: 'mode', label: 'How', type: 'select', required: true, options: Object.entries(MODE).map(([value, label]) => ({ value, label })) },
          { key: 'venue', label: 'Venue', wide: true, show: (v) => v.mode !== 'VIDEO' }, { key: 'videoLink', label: 'Video link', wide: true, show: (v) => v.mode !== 'PHYSICAL' },
          { key: 'shorterNotice', label: x.type === 'BOARD' ? 'Held at shorter notice for urgent business' : 'Consent of members to shorter notice received', type: 'checkbox', wide: true },
        ]}
        onSave={(v) => api(`/meetings/${x.id}`, { method: 'PATCH', body: { title: v.title, date: v.date, time: v.time, mode: v.mode, venue: v.venue, videoLink: v.videoLink, shorterNotice: !!v.shorterNotice } }).then(reload)} onClose={() => setDlg(undefined)} />}
      {dlg === 'notice' && <RecordModal title="Notice sent" saveLabel="Save" initial={{ on: today(), shorterNotice: x.shorterNotice }}
        fields={[{ key: 'on', label: 'Notice sent on', type: 'date', required: true }, { key: 'shorterNotice', label: x.type === 'BOARD' ? 'Shorter notice for urgent business' : 'Members have consented to shorter notice', type: 'checkbox', wide: true }]}
        onSave={(v) => api(`/meetings/${x.id}/notice-sent`, { body: { on: v.on, shorterNotice: !!v.shorterNotice } }).then(reload)} onClose={() => setDlg(undefined)} />}
      {dlg === 'held' && <RecordModal title="Record the meeting as held" saveLabel="Record as held" initial={{ on: x.date <= today() ? x.date : today() }}
        extra={<p className="muted small" style={{ marginTop: 0 }}>This ticks off the {x.type === 'AGM' ? 'AGM' : x.type === 'BOARD' ? 'board meeting for the period' : 'meeting'} on the compliance calendar{x.type === 'AGM' ? ' (AOC-4, MGT-7 and ADT-1 dates follow it)' : ''}, and puts the filings of passed items on the calendar.</p>}
        fields={[{ key: 'on', label: 'Held on', type: 'date', required: true }]}
        onSave={(v) => api(`/meetings/${x.id}/held`, { body: { on: v.on } }).then(reload)} onClose={() => setDlg(undefined)} />}
      {dlg === 'sign' && <RecordModal title="Minutes signed" saveLabel="Mark signed" initial={{ on: today() }}
        extra={<p className="muted small" style={{ marginTop: 0 }}>Signed minutes can’t be changed afterwards.</p>}
        fields={[{ key: 'on', label: 'Signed by the Chairperson on', type: 'date', required: true }]}
        onSave={(v) => api(`/meetings/${x.id}/minutes-signed`, { body: { on: v.on } }).then(reload)} onClose={() => setDlg(undefined)} />}
      {dlg === 'add' && <AddItem d={data} onClose={() => setDlg(undefined)} onSaved={reload} />}
      {dlg && typeof dlg === 'object' && <RecordModal title="Agenda item" initial={dlg}
        fields={[
          { key: 'title', label: 'Title', wide: true, required: true },
          { key: 'resolutionType', label: 'Kind', type: 'select', required: true, options: Object.entries(RES).filter(([k]) => x.type === 'BOARD' ? !['ORDINARY', 'SPECIAL'].includes(k) : k !== 'BOARD').map(([value, label]) => ({ value, label })) },
          { key: 'personId', label: 'About (director / KMP)', type: 'select', options: data.people.map((p) => ({ value: p.id, label: `${p.name} — ${DESIGNATION[p.designation] ?? p.designation}` })) },
          { key: 'text', label: 'Text', type: 'textarea', wide: true },
          { key: 'filings', label: 'Filings to put on the calendar when passed', type: 'checks', options: meta.eventRules.map((r) => ({ value: r.code, label: `${r.form} — ${r.title} (${r.days} days)` })) },
        ]}
        onSave={(v) => api(`/meetings/items/${dlg.id}`, { method: 'PATCH', body: { title: v.title, resolutionType: v.resolutionType, personId: v.personId, text: v.text, filings: v.filings } }).then(reload)}
        danger={{ label: 'Remove item', onClick: () => api(`/meetings/items/${dlg.id}`, { method: 'DELETE' }).then(reload) }}
        onClose={() => setDlg(undefined)} />}
    </div>
  );
}

function AddItem({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Detail['templates'][number] | 'custom'>();
  const list = d.templates.filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()));
  if (pick) return (
    <RecordModal title={pick === 'custom' ? 'Your own agenda item' : pick.title} saveLabel="Add to agenda"
      fields={pick === 'custom'
        ? [{ key: 'title', label: 'Title', required: true, wide: true }, { key: 'resolutionType', label: 'Kind', type: 'select', required: true, options: Object.entries(RES).filter(([k]) => d.meeting.type === 'BOARD' ? !['ORDINARY', 'SPECIAL'].includes(k) : k !== 'BOARD').map(([value, label]) => ({ value, label })) }, { key: 'text', label: 'Text', type: 'textarea', wide: true }]
        : pick.person ? [{ key: 'personId', label: 'Director / KMP', type: 'select', required: true, options: d.people.map((p) => ({ value: p.id, label: `${p.name} — ${DESIGNATION[p.designation] ?? p.designation}` })), help: 'Add the person under Directors & KMP first if they’re new.' }] : []}
      extra={pick !== 'custom' ? <p className="muted small" style={{ marginTop: 0 }}>The wording is filled in from a standard draft — edit it after adding.{pick.filings.length ? ` When passed, it creates: ${pick.filings.join(', ')}.` : ''}</p> : undefined}
      initial={{ resolutionType: d.meeting.type === 'BOARD' ? 'BOARD' : 'ORDINARY' }}
      onSave={(v) => api(`/meetings/${d.meeting.id}/items`, { body: pick === 'custom' ? { title: v.title, resolutionType: v.resolutionType, text: v.text } : { templateKey: pick.key, personId: v.personId } }).then(onSaved)}
      onClose={onClose} />
  );
  return (
    <Modal title="Add an agenda item" wide onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <input autoFocus placeholder="Search: director, allotment, charge, auditor…" value={q} onChange={(e) => setQ(e.target.value)} />
      <table className="table compact" style={{ marginTop: 8 }}><tbody>
        {list.map((t) => <tr key={t.key} onClick={() => setPick(t)}><td><strong>{t.title}</strong><span className="muted small block">{RES[t.resolutionType]}{t.filings.length ? ` · creates ${t.filings.join(', ')}` : ''}{t.completes.length ? ' · completes MBP-1 / DIR-8' : ''}</span></td></tr>)}
        <tr onClick={() => setPick('custom')}><td><strong>Something else…</strong><span className="muted small block">Your own item or resolution</span></td></tr>
      </tbody></table>
    </Modal>
  );
}

function Attendance({ d, edit, onSaved }: { d: Detail; edit: boolean; onSaved: () => void }) {
  const [rows, setRows] = useState(d.attendance);
  const [members, setMembers] = useState<string>(d.meeting.membersPresent?.toString() ?? '');
  const [chair, setChair] = useState(d.meeting.chairpersonId ?? '');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string }>();
  useEffect(() => setRows(d.attendance), [d.attendance]);
  const gm = d.meeting.type !== 'BOARD';
  const save = async () => {
    setMsg(undefined);
    try {
      await api(`/meetings/${d.meeting.id}/attendance`, { method: 'PUT', body: rows.filter((r) => r.status).map((r) => ({ personId: r.personId, status: r.status })) });
      await api(`/meetings/${d.meeting.id}`, { method: 'PATCH', body: { chairpersonId: chair || null, ...(gm ? { membersPresent: members === '' ? null : Number(members) } : {}) } });
      setMsg({ kind: 'success', text: 'Saved.' }); onSaved();
    } catch (e: any) { setMsg({ kind: 'error', text: e.message }); }
  };
  return (
    <section className="card">
      <div className="toolbar"><h3>Attendance</h3></div>
      {rows.length === 0 ? <p className="pad muted small">No directors in office on the meeting date. Add them under the company’s Directors &amp; KMP.</p> : (
        <table className="table compact static"><tbody>{rows.map((r, i) => (
          <tr key={r.personId}><td><strong>{r.name}</strong><span className="muted small block">{DESIGNATION[r.designation] ?? r.designation}{r.din && ` · DIN ${r.din}`}</span></td>
            <td style={{ width: 150 }}>{edit ? <select value={r.status ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, status: e.target.value || null } : x)))} aria-label={`${r.name} attendance`}>
              <option value="">—</option><option value="PRESENT">Present</option><option value="VIDEO">By video</option><option value="LEAVE">Leave of absence</option><option value="ABSENT">Absent</option></select>
              : <span className="small">{({ PRESENT: 'Present', VIDEO: 'By video', LEAVE: 'Leave of absence', ABSENT: 'Absent' } as Record<string, string>)[r.status ?? ''] ?? '—'}</span>}</td></tr>
        ))}</tbody></table>
      )}
      <div className="pad stack" style={{ gap: 10 }}>
        {gm && <div className="field"><label>Members present in person</label><input type="number" min={0} value={members} disabled={!edit} onChange={(e) => setMembers(e.target.value)} /></div>}
        <div className="field"><label>Chairperson</label><select value={chair} disabled={!edit} onChange={(e) => setChair(e.target.value)}><option value="">—</option>{rows.map((r) => <option key={r.personId} value={r.personId}>{r.name}</option>)}</select></div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {edit && <div><button className="btn btn-primary btn-sm" onClick={save}>Save attendance</button></div>}
      </div>
    </section>
  );
}

function Minutes({ d, edit, onSaved }: { d: Detail; edit: boolean; onSaved: () => void }) {
  const signed = d.meeting.status === 'MINUTES_SIGNED';
  const [text, setText] = useState(d.meeting.minutes ?? '');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string }>();
  const draft = async () => {
    if (text.trim() && !window.confirm('Replace what is written with a fresh draft?')) return;
    setText((await api<{ text: string }>(`/meetings/${d.meeting.id}/minutes-draft`)).text);
  };
  const save = async () => { setMsg(undefined); try { await api(`/meetings/${d.meeting.id}/minutes`, { method: 'PUT', body: { text } }); setMsg({ kind: 'success', text: 'Minutes saved.' }); onSaved(); } catch (e: any) { setMsg({ kind: 'error', text: e.message }); } };
  return (
    <section className="card">
      <div className="toolbar"><h3>Minutes</h3>{signed && <span className="badge badge-approved">Signed {fmtDate(d.meeting.minutesSignedOn)}</span>}<span className="grow" />
        {edit && !signed && <><button className="btn btn-sm btn-secondary" onClick={draft}>{text.trim() ? 'Re-draft from the meeting' : 'Draft from the meeting'}</button><button className="btn btn-sm btn-primary" onClick={save}>Save</button></>}</div>
      <div className="pad stack">
        {!signed && !text && <p className="muted small" style={{ margin: 0 }}>Record attendance and each item’s outcome, then draft the minutes — the wording comes from the agenda and you edit it here.</p>}
        <textarea rows={signed ? 18 : 16} value={text} readOnly={signed || !edit} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }} />
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      </div>
    </section>
  );
}
