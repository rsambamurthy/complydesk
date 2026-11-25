/**
 * "Ask ComplyDesk": the help assistant. One component for the Help page and the "?" drawer.
 * Answers come from the user manual (AI when set up, otherwise manual search); each links to its manual sections.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { Markdown } from './Markdown';

interface Answer { id: string; answer: string; covered: boolean; mode: 'ai' | 'search'; sections: { id: string; title: string }[] }
interface Msg { role: 'user' | 'assistant'; text: string; a?: Answer; rated?: boolean; error?: boolean }
export interface HelpIndex { title: string; mode: 'ai' | 'search'; sections: { id: string; title: string; level: 2 | 3; parent: string | null }[]; pageSection: string | null; suggestions: string[] }

/** The page the user is working on (the Help page itself passes the page they came from). */
export function useHelpIndex(page: string) {
  const [idx, setIdx] = useState<HelpIndex>();
  useEffect(() => { api<HelpIndex>(`/help?page=${encodeURIComponent(page)}`).then(setIdx).catch(() => undefined); }, [page]);
  return idx;
}

export function HelpAssistant({ page, index, onOpenSection }: { page: string; index?: HelpIndex; onOpenSection?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs, busy]);

  const ask = async (question: string) => {
    question = question.trim();
    if (!question || busy) return;
    const history = msgs.filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setQ(''); setBusy(true);
    try {
      const a = await api<Answer>('/help/ask', { body: { question, page, history } });
      setMsgs((m) => [...m, { role: 'assistant', text: a.answer, a }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', text: e.message, error: true }]);
    } finally { setBusy(false); }
  };
  const rate = async (i: number, helpful: boolean) => {
    const a = msgs[i].a; if (!a) return;
    setMsgs((m) => m.map((x, k) => (k === i ? { ...x, rated: true } : x)));
    api(`/help/ask/${a.id}/rate`, { body: { helpful } }).catch(() => undefined);
  };
  const sectionLink = (id: string) => `/help/${id}${loc.pathname.startsWith('/help') ? '' : `?from=${encodeURIComponent(page)}`}`;

  return (
    <div className="ha">
      <div className="ha-log" aria-live="polite">
        {!msgs.length && (
          <div className="ha-intro">
            <p>Ask how to do something in ComplyDesk — answers come from the user manual{index?.mode === 'search' ? ' (manual search; the AI assistant isn’t switched on in this workspace)' : ''}.</p>
            {!!index?.suggestions.length && <div className="ha-sugs">{index.suggestions.map((s) => <button key={s} type="button" className="chip-btn" onClick={() => ask(s)}>{s}</button>)}</div>}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ha-msg ${m.role}${m.error ? ' err' : ''}`}>
            {m.role === 'user' ? <p>{m.text}</p> : <Markdown text={m.text} />}
            {m.a && (
              <div className="ha-meta">
                {!!m.a.sections.length && <span>From the manual: {m.a.sections.map((s, k) => <span key={s.id}>{k ? ' · ' : ''}<Link to={sectionLink(s.id)} onClick={onOpenSection}>{s.title.replace(/^\d+\.\s*/, '')}</Link></span>)}</span>}
                <span className="ha-rate">{m.rated ? 'Thanks' : <>Helpful? <button type="button" className="link-btn" onClick={() => rate(i, true)} aria-label="Helpful">👍</button> <button type="button" className="link-btn" onClick={() => rate(i, false)} aria-label="Not helpful">👎</button></>}</span>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="ha-msg assistant"><span className="muted small">Looking it up…</span></div>}
        <div ref={end} />
      </div>
      <form className="ha-ask" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question, e.g. how do I mark the AGM held?" maxLength={500} aria-label="Your question" />
        <button className="btn btn-primary" disabled={busy || q.trim().length < 2}>Ask</button>
      </form>
      {msgs.length > 0 && <button type="button" className="link-btn small ha-clear" onClick={() => setMsgs([])}>New conversation</button>}
    </div>
  );
}
