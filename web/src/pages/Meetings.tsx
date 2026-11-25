import { useSearchParams } from 'react-router-dom';
import { useLoad } from '../lib/hooks';
import { Alert, Spinner } from '../components/ui';
import { MeetingList, ScheduleButton, type MeetingRow } from '../components/Meetings';
import { useSession } from '../lib/session';

const VIEWS = [{ key: 'upcoming', label: 'Coming up' }, { key: 'minutes', label: 'Minutes pending' }, { key: 'held', label: 'Held' }, { key: 'all', label: 'All' }];

export function Meetings() {
  const [qs, setQs] = useSearchParams();
  const view = qs.get('view') ?? 'upcoming';
  const { data, error } = useLoad<MeetingRow[]>(`/meetings?view=${view}`);
  const { can } = useSession();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Meetings</h1><p className="muted">Board meetings and general meetings for every client — agenda, notice, attendance, resolutions and minutes.</p></div>
        {can('compliance.work') && <div className="head-actions"><ScheduleButton /></div>}</div>
      <div className="card filter-bar"><div className="seg">{VIEWS.map((v) => <button key={v.key} className={`seg-btn ${view === v.key ? 'active' : ''}`} onClick={() => setQs({ view: v.key }, { replace: true })}>{v.label}</button>)}</div></div>
      {error && <Alert kind="error">{error}</Alert>}
      <section className="card">{data ? <MeetingList rows={data} empty={view === 'upcoming' ? 'No meetings coming up. Schedule one.' : view === 'minutes' ? 'No minutes waiting to be signed.' : 'No meetings yet.'} /> : <Spinner />}</section>
    </div>
  );
}

/** A client's Meetings tab. */
export function ClientMeetings({ clientId }: { clientId: string }) {
  const { data, error } = useLoad<MeetingRow[]>(`/meetings?clientId=${clientId}&view=all`);
  const { can } = useSession();
  return (
    <>
      <div className="toolbar"><h3>Meetings</h3><span className="grow" />{can('compliance.work') && <ScheduleButton clientId={clientId} />}</div>
      {error && <Alert kind="error">{error}</Alert>}
      {data ? <MeetingList rows={data} showClient={false} empty="No meetings yet." /> : <Spinner />}
    </>
  );
}
