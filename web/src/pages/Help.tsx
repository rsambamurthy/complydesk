/** Help: the user manual inside ComplyDesk — contents, search, each section, and the assistant. /help and /help/:id. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Markdown } from '../components/Markdown';
import { HelpAssistant, useHelpIndex } from '../components/HelpAssistant';
import { Spinner } from '../components/ui';

interface Section { id: string; title: string; body: string; children: { id: string; title: string; body: string }[] }
interface Hit { id: string; title: string; snippet: string }

const short = (t: string) => t.replace(/^\d+\.\s*/, '');

export function Help() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const from = sp.get('from') ?? '/help';
  const idx = useHelpIndex(from);
  const nav = useNavigate();
  const [sec, setSec] = useState<Section>();
  const [err, setErr] = useState<string>();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>();

  useEffect(() => {
    setSec(undefined); setErr(undefined);
    if (id) api<Section>(`/help/sections/${id}`).then(setSec).catch((e) => setErr(e.message));
    window.scrollTo(0, 0);
  }, [id]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(undefined); return; }
    const t = setTimeout(() => api<Hit[]>(`/help/search?q=${encodeURIComponent(q)}`).then(setHits).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [q]);

  const top = useMemo(() => idx?.sections.filter((s) => s.level === 2) ?? [], [idx]);
  const current = sec && idx?.sections.find((s) => s.id === sec.id);
  const chapter = current?.parent ?? current?.id;
  const pos = top.findIndex((s) => s.id === chapter);

  return (
    <div className="page help-page">
      <div className="page-head">
        <div><h1>Help</h1><p className="muted">The ComplyDesk user manual, and an assistant that answers from it.</p></div>
        {from !== '/help' && <div className="head-actions"><button className="btn btn-secondary" onClick={() => nav(from)}>Back to where I was</button></div>}
      </div>
      <div className="help-grid">
        <aside className="card pad help-toc">
          <input className="help-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the manual" aria-label="Search the manual" />
          {hits ? (
            <div className="help-hits">
              {!hits.length && <p className="muted small">Nothing found — try the assistant.</p>}
              {hits.map((h) => <Link key={h.id} to={`/help/${h.id}`} onClick={() => setQ('')}><b>{short(h.title)}</b><span className="muted small">{h.snippet}</span></Link>)}
            </div>
          ) : (
            <nav>
              <Link to="/help" className={!id ? 'on' : ''}>Ask ComplyDesk</Link>
              {top.map((s) => (
                <div key={s.id}>
                  <Link to={`/help/${s.id}`} className={chapter === s.id ? 'on' : ''}>{s.title}</Link>
                  {chapter === s.id && idx!.sections.filter((c) => c.parent === s.id).map((c) => <Link key={c.id} to={`/help/${c.id}`} className={`sub ${id === c.id ? 'on' : ''}`}>{c.title}</Link>)}
                </div>
              ))}
            </nav>
          )}
        </aside>
        <main className="help-main">
          {!id && (
            <section className="card pad">
              <h2 style={{ marginTop: 0 }}>Ask ComplyDesk</h2>
              {idx ? <HelpAssistant page={from} index={idx} /> : <Spinner />}
              {idx?.pageSection && from !== '/help' && <p className="small muted" style={{ marginBottom: 0 }}>Help for the page you came from: <Link to={`/help/${idx.pageSection}?from=${encodeURIComponent(from)}`}>{short(idx.sections.find((s) => s.id === idx.pageSection)!.title)}</Link></p>}
            </section>
          )}
          {id && (
            <section className="card pad help-article">
              {err && <p className="overdue">{err}</p>}
              {!sec && !err && <Spinner />}
              {sec && <>
                <h2 style={{ marginTop: 0 }}>{sec.title}</h2>
                <Markdown text={sec.body} headingOffset={1} />
                {sec.children.map((c) => <div key={c.id} id={c.id}><h3>{c.title}</h3><Markdown text={c.body} headingOffset={2} /></div>)}
                <div className="help-pager">
                  {pos > 0 ? <Link to={`/help/${top[pos - 1].id}`}>← {short(top[pos - 1].title)}</Link> : <span />}
                  {pos >= 0 && pos < top.length - 1 ? <Link to={`/help/${top[pos + 1].id}`}>{short(top[pos + 1].title)} →</Link> : <span />}
                </div>
                <p className="small muted">Still stuck? <Link to="/help">Ask ComplyDesk</Link> or write to info@integratatech.ai.</p>
              </>}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
