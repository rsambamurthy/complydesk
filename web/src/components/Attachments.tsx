/** Files on a client, a filing or a meeting: list, open, add (drag or pick), remove. */
import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { fmtDateTime, fmtSize } from '../lib/format';
import { Alert } from './ui';
import { DropZone } from './DropZone';

interface F { id: string; fileName: string; contentType: string; size: number; uploadedByName: string | null; createdAt: string }

export function Attachments({ entity, entityId, canAdd, canRemove, compact, onChange }: { entity: 'client' | 'obligation' | 'meeting'; entityId: string; canAdd: boolean; canRemove: boolean; compact?: boolean; onChange?: () => void }) {
  const { data, error, reload } = useLoad<F[]>(`/files?entity=${entity}&entityId=${entityId}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const send = async (files: File[]) => {
    setBusy(true); setErr(undefined);
    try {
      for (const f of files) {
        if (f.size > 15 * 1024 * 1024) throw new Error(`${f.name} is larger than 15 MB`);
        const fd = new FormData(); fd.append('entity', entity); fd.append('entityId', entityId); fd.append('file', f);
        await api('/files', { body: fd });
      }
      reload(); onChange?.();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
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
            {canRemove && <button className="icon-btn" title="Remove" onClick={async () => { if (window.confirm(`Remove ${f.fileName}?`)) { await api(`/files/${f.id}`, { method: 'DELETE' }).catch((e) => setErr(e.message)); reload(); onChange?.(); } }}>✕</button>}
          </li>
        ))}</ul>
      )}
      {data && data.length === 0 && !canAdd && <span className="muted small">No files.</span>}
      {canAdd && <DropZone multiple onFiles={send} busy={busy && 'Uploading…'} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.zip,.txt">PDF, images, Word, Excel, zip · up to 15 MB</DropZone>}
    </div>
  );
}
