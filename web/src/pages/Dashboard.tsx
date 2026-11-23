import { Link } from 'react-router-dom';
import { useLoad, useMeta } from '../lib/hooks';
import type { Obligation, Summary } from '../lib/types';
import { ObligationTable } from '../components/Obligations';
import { Alert, Spinner } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';

interface Dash { all: Summary; mine: Summary; attention: { id: string; name: string; cin: string; overdue: number; due30: number; nextDue: string | null }[] }

export function Dashboard() {
  const { me } = useSession();
  const dash = useLoad<Dash>('/obligations/dashboard');
  const urgent = useLoad<Obligation[]>('/obligations?bucket=overdue');
  const week = useLoad<Obligation[]>('/obligations?bucket=week');
  const meta = useMeta();
  const reload = () => { dash.reload(); urgent.reload(); week.reload(); };
  if (dash.error) return <div className="page"><Alert kind="error">{dash.error}</Alert></div>;
  if (!dash.data) return <Spinner />;
  const { all, mine, attention } = dash.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {me!.user.name.split(' ')[0]}</h1><p className="muted">Where every client stands today.</p></div></div>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <Tile to="/calendar?bucket=overdue" n={all.overdue} label="Overdue" bad={all.overdue > 0} sub={mine.overdue ? `${mine.overdue} with you` : undefined} />
        <Tile to="/calendar?bucket=week" n={all.week} label="Due in 7 days" warn={all.week > 0} sub={mine.week ? `${mine.week} with you` : undefined} />
        <Tile to="/calendar?bucket=month" n={all.month} label="Due in 30 days" />
        <Tile to="/calendar?bucket=open" n={all.open} label="Open in all" />
        <Tile to="/calendar?bucket=done" n={all.done} label="Done (this & last FY)" />
      </div>
      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <div className="toolbar"><h3>Overdue</h3><span className="grow" /><Link to="/calendar?bucket=overdue" className="small">See all</Link></div>
            {urgent.data ? <ObligationTable rows={urgent.data.slice(0, 12)} meta={meta} onChanged={reload} empty="Nothing overdue. 🎉" /> : <Spinner />}
          </section>
          <section className="card">
            <div className="toolbar"><h3>Due in the next 7 days</h3><span className="grow" /><Link to="/calendar?bucket=week" className="small">See all</Link></div>
            {week.data ? <ObligationTable rows={week.data} meta={meta} onChanged={reload} empty="Nothing due this week." /> : <Spinner />}
          </section>
        </div>
        <section className="card">
          <div className="toolbar"><h3>Clients needing attention</h3></div>
          {attention.length === 0 ? <p className="pad muted">All clients are on track.</p> : (
            <table className="table compact static"><tbody>
              {attention.map((c) => (
                <tr key={c.id}><td><Link to={`/clients/${c.id}`}>{c.name}</Link>
                  <span className="small block">{c.overdue > 0 && <span className="overdue">{c.overdue} overdue</span>}{c.overdue > 0 && c.due30 > 0 && ' · '}{c.due30 > 0 && <span className="muted">{c.due30} due in 30 days</span>}</span>
                  {c.nextDue && <span className="muted small block">Next: {fmtDate(c.nextDue)}</span>}</td></tr>
              ))}
            </tbody></table>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ to, n, label, sub, bad, warn }: { to: string; n: number; label: string; sub?: string; bad?: boolean; warn?: boolean }) {
  return (
    <Link to={to} className="card tile">
      <span className={`tile-n ${bad ? 'tile-bad' : warn ? 'tile-warn' : ''}`}>{n}</span>
      <span className="tile-l">{label}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </Link>
  );
}
