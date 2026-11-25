/**
 * One form component for every record (client, director, shareholder, auditor, user, obligation): fields are
 * described as data, server field errors ({ field: message }) appear under the right field.
 */
import { useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { Alert, Modal } from './ui';

export type FieldDef = {
  key: string; label: string; help?: string; wide?: boolean; required?: boolean; placeholder?: string;
  type?: 'text' | 'date' | 'number' | 'email' | 'password' | 'textarea' | 'select' | 'checkbox' | 'checks' | 'custom';
  /** For type 'custom': draws the input (e.g. a search picker). */
  render?: (value: any, set: (v: any) => void) => import('react').ReactNode;
  options?: { value: string; label: string }[];
  /** Hide the field depending on the other values. */
  show?: (v: Record<string, any>) => boolean;
};

export function useRecordForm(initial: Record<string, any>) {
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => { setValues((p) => ({ ...p, [k]: v })); setErrors((p) => ({ ...p, [k]: '' })); };
  async function submit(fn: (v: Record<string, any>) => Promise<unknown>) {
    setBusy(true); setError(undefined); setErrors({});
    try { await fn(values); return true; } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.details);
      setError(e instanceof Error ? e.message : String(e)); return false;
    } finally { setBusy(false); }
  }
  return { values, set, errors, setErrors, error, setError, busy, submit };
}

/** `check`: { field: message } for values a person should look at (e.g. read from a document and unclear). */
export function Fields({ fields, form, check }: { fields: FieldDef[]; form: ReturnType<typeof useRecordForm>; check?: Record<string, string> }) {
  const { values, set, errors } = form;
  return (
    <div className="field-grid">
      {fields.filter((f) => !f.show || f.show(values)).map((f) => {
        const id = `f-${f.key}`;
        const err = errors[f.key];
        const v = values[f.key];
        const chk = !err && check?.[f.key];
        if (f.type === 'checkbox') return (
          <label key={f.key} className={`check-item ${f.wide ? 'field-wide' : ''}`}>
            <input type="checkbox" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} />
            <span><strong>{f.label}</strong>{f.help && <span className="muted small block">{f.help}</span>}</span>
          </label>
        );
        if (f.type === 'custom') return (
          <div key={f.key} className={`field ${f.wide ? 'field-wide' : ''} ${err ? 'has-error' : ''}`}>
            <label>{f.label}{f.required && <span className="req"> *</span>}</label>
            {f.render!(v, (x) => set(f.key, x))}
            {f.help && !err && <span className="field-help">{f.help}</span>}
            {err && <span className="field-error">{err}</span>}
          </div>
        );
        if (f.type === 'checks') return (
          <fieldset key={f.key} className="field field-wide" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{f.label}</legend>
            {f.options!.map((o) => (
              <label key={o.value} className="check-item"><input type="checkbox" checked={(v ?? []).includes(o.value)}
                onChange={(e) => set(f.key, e.target.checked ? [...(v ?? []), o.value] : (v ?? []).filter((x: string) => x !== o.value))} /><span>{o.label}</span></label>
            ))}
            {err && <span className="field-error">{err}</span>}
          </fieldset>
        );
        return (
          <div key={f.key} className={`field ${f.wide ? 'field-wide' : ''} ${err ? 'has-error' : ''} ${chk ? 'needs-check' : ''}`}>
            <label htmlFor={id}>{f.label}{f.required && <span className="req"> *</span>}</label>
            {f.type === 'select' ? (
              <select id={id} value={v ?? ''} onChange={(e) => set(f.key, e.target.value || null)}>
                {!f.required && <option value="">—</option>}
                {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea id={id} rows={3} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <input id={id} type={f.type ?? 'text'} value={v ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}
            {chk ? <span className="field-check">{chk}</span> : f.help && !err && <span className="field-help">{f.help}</span>}
            {err && <span className="field-error">{err}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** A modal with a record form: Save calls onSave(values); closes on success. */
export function RecordModal({ title, fields, initial, onSave, onClose, saveLabel = 'Save', extra, danger, keepOpen }: {
  title: string; fields: FieldDef[]; initial: Record<string, any>; onSave: (v: Record<string, any>) => Promise<unknown>; onClose: () => void;
  saveLabel?: string; extra?: ReactNode; danger?: { label: string; onClick: () => Promise<unknown> };
  /** Stay open after a successful save (a step that leads to another form). */
  keepOpen?: boolean;
}) {
  const form = useRecordForm(initial);
  return (
    <Modal title={title} wide onClose={onClose} footer={<>
      {danger && <button className="btn btn-danger-ghost" style={{ marginInlineEnd: 'auto' }} disabled={form.busy} onClick={() => form.submit(danger.onClick).then((ok) => ok && onClose())}>{danger.label}</button>}
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={form.busy} onClick={async () => { if (await form.submit(onSave) && !keepOpen) onClose(); }}>{saveLabel}</button>
    </>}>
      {form.error && <Alert kind="error">{form.error}</Alert>}
      {extra}
      <Fields fields={fields} form={form} />
    </Modal>
  );
}
