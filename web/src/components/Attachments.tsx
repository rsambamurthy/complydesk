/** Files on a filing or a meeting: list, open, add (drag or pick), remove. */
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDateTime, fmtSize } from '../lib/format';
import { Alert } from './ui';

interface F { id: string; fileName: string; contentType: string; size: number; uploadedByName: string | null; createdAt: string }

export function Attachments({ entity, entityId, canAdd, canRemove, compact }: { entity: 'obligation' | 'meeting'; entityId: string; canAdd: boolean; canRemove: boolean; compact?: boolean }) {
  const { data, error, reload } = useLoad<F[]>(`/files?entity=${entity}&entityId=${entityId}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr(undefined);
    try {
      for (const f of Array.from(files)) {
        if (f.size > 15 * 1024 * 1024) throw new Error(`${f.name} is larger than 15 MB`);
        const fd = new FormData(); fd.append('entity', entity); fd.append('entityId', entityId); fd.append('file', f);
        await api('/files', { body: fd });
      }
      reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {(error || err) && <Alert kind="error">{error ?? err}</Alert>}
      {data && data.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{data.map((f) => (
          <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border, #eee)' }}>
            <span aria-hidden>📄</span>
            <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.fileName}</a>
            <span className="muted small nowrap">{fmtSize(f.size)}{!compact && ` · ${f.uploadedByName ?? ''} · ${fmtDateTime(f.createdAt)}`}</span>
            {canRemove && <button className="icon-btn" title="Remove" onClick={async () => { if (window.confirm(`Remove ${f.fileName}?`)) { await api(`/files/${f.id}`, { method: 'DELETE' }).catch((e) => setErr(e.message)); reload(); } }}>✕</button>}
          </li>
        ))}</ul>
      )}
      {data && data.length === 0 && !canAdd && <span className="muted small">No files.</span>}
      {canAdd && (
        <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
          style={{ border: `1.5px dashed ${over ? '#2f6fde' : '#c9cfdb'}`, borderRadius: 8, padding: 12, textAlign: 'center', background: over ? '#eef3fd' : undefined }}>
          <input ref={input} type="file" multiple hidden onChange={(e) => send(e.target.files)} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.zip,.txt" />
          <span className="small">{busy ? 'Uploading…' : <>Drop files here or <a href="#" onClick={(e) => { e.preventDefault(); input.current?.click(); }}>choose</a> — PDF, images, Word, Excel, zip · up to 15 MB</>}</span>
        </div>
      )}
    </div>
  );
}
