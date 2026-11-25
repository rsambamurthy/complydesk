/** Small Markdown renderer for help content and assistant answers: headings, paragraphs, lists, tables, images, bold/italic/code, links. No HTML passes through. */
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0; let m: RegExpExecArray | null; let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0]; const k = `${key}-${n++}`;
    if (t.startsWith('**')) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out.push(href.startsWith('/') ? <Link key={k} to={href}>{label}</Link> : /^(https?:|mailto:)/.test(href) ? <a key={k} href={href} target="_blank" rel="noreferrer">{label}</a> : label);
    } else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  // Plain e-mail addresses become links.
  return out.flatMap((p, i) => typeof p !== 'string' ? [p] : p.split(/([\w.+-]+@[\w-]+\.[\w.]+)/).map((s, j) => (j % 2 ? <a key={`${key}-m${i}-${j}`} href={`mailto:${s}`}>{s}</a> : s)));
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ text, headingOffset = 0 }: { text: string; headingOffset?: number }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0; let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim());
    if (h) {
      const lvl = Math.min(6, h[1].length + headingOffset);
      const Tag = `h${lvl}` as 'h2';
      blocks.push(<Tag key={b++}>{inline(h[2])}</Tag>); i++;
    } else if (img) {
      // The next line is the caption in the manual; skip it when it repeats the alt text.
      const cap = lines[i + 1]?.trim() === img[1] ? lines[++i].trim() : img[1];
      blocks.push(<figure key={b++} className="md-fig"><img src={img[2]} alt={img[1]} loading="lazy" />{cap && <figcaption>{cap}</figcaption>}</figure>); i++;
    } else if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(cells(lines[i])); i++; }
      const [head, ...body] = rows;
      blocks.push(<div key={b++} className="md-table"><table className="table"><thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) || (!lines[i].trim() && /^\s*([-*]|\d+[.)])\s+/.test(lines[i + 1] ?? '')))) {
        if (lines[i].trim()) items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ''));
        i++;
      }
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={b++}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</L>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*([-*]|\d+[.)])\s+|!\[)/.test(lines[i])) para.push(lines[i++].trim());
      blocks.push(<p key={b++}>{inline(para.join(' '))}</p>);
    }
  }
  return <div className="md">{blocks.map((x, k) => <Fragment key={k}>{x}</Fragment>)}</div>;
}
