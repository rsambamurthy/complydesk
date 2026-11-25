/** The one file drop area (attachments, reading documents, DSC files): drag files in or pick them. */
import { useRef, useState, type ReactNode } from 'react';

export function DropZone({ onFiles, accept, multiple, busy, children }: { onFiles: (f: File[]) => void; accept: string; multiple?: boolean; busy?: ReactNode; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = (list: FileList | null) => { if (list?.length) onFiles(Array.from(list)); if (input.current) input.current.value = ''; };
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      style={{ border: `1.5px dashed ${over ? '#2f6fde' : '#c9cfdb'}`, borderRadius: 8, padding: 12, textAlign: 'center', background: over ? '#eef3fd' : undefined }}>
      <input ref={input} type="file" multiple={multiple} hidden onChange={(e) => take(e.target.files)} accept={accept} />
      <span className="small">{busy || <>Drop {multiple ? 'files' : 'the file'} here or <a href="#" onClick={(e) => { e.preventDefault(); input.current?.click(); }}>choose</a> — {children}</>}</span>
    </div>
  );
}
