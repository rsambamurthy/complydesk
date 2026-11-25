/** Time spent: list and log entries for a filing (or a client). One component for the filing window and the Team page. */
import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { fmtDate, today } from '../lib/format';
import { Alert } from './ui';

export interface TimeRow { id: string; date: string; minutes: number; note: string | null; userId: string; userName: string; clientId: string; clientName: string; obligationId: string | null; form: string | null }
export const hrs = (m: number) => { const h = Math.floor(m / 60); const r = m % 60; return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`; };

export function TimeLog({ obligationId, clientId, compact }: { obligationId?: string; clientId?: string; compact?: boolean }) {
  const q = new URLSearchParams({ ...(obligationId ? { obligationId } : {}), ...(clientId ? { clientId } : {}) }).toString();
  const { data, reload } = useLoad<TimeRow[]>(`/team/time?${q}`);
  const { can, me } = useSession();
  const [date, setDate] = useState(today());
  const [h, setH] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string>();
  if (!can('compliance.work') || me?.user.clientIds.length) return null;
  const total = (data ?? []).reduce((s, x) => s + x.minutes, 0);
  const add = async () => {
    setErr(undefined);
    try { await api('/team/time', { body: { obligationId, clientId, date, hours: h, note } }); setH(''); setNote(''); reload(); }
    catch (e: any) { setErr(e.details ? Object.values(e.details).join(' ') : e.message); }
  };
  return (
    <div className="time-log">
      <div className="toolbar" style={{ padding: 0 }}><b className="small">Time spent{total ? `: ${hrs(total)}` : ''}</b></div>
      {!compact && !!data?.length && (
        <ul className="small" style={{ listStyle: 'none', margin: '4px 0', padding: 0 }}>
          {data.slice(0, 8).map((t) => <li key={t.id} className="time-row"><span className="muted">{fmtDate(t.date)}</span> · {t.userName} · <b>{hrs(t.minutes)}</b>{t.note && <span className="muted"> — {t.note}</span>}
            {(t.userId === me?.user.id || can('team.view')) && <button className="link-btn danger small" onClick={async () => { await api(`/team/time/${t.id}`, { method: 'DELETE' }); reload(); }} aria-label="Remove">✕</button>}</li>)}
        </ul>
      )}
      <div className="time-add">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input inputMode="decimal" placeholder="Hours, e.g. 1.5" value={h} onChange={(e) => setH(e.target.value)} aria-label="Hours" />
        <input placeholder="What you did (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        <button className="btn btn-sm btn-secondary" disabled={!h} onClick={add}>Log time</button>
      </div>
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  );
}
