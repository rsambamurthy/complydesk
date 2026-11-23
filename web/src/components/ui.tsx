import { useEffect, type ReactNode } from 'react';
import type { ObStatus } from '../lib/types';
import { STATUS_LABEL, daysFrom, fmtDate, isDone } from '../lib/format';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>;
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Spinner = () => <div className="spinner" />;

const STATUS_CLASS: Record<ObStatus, string> = { OPEN: 'badge-invited', IN_PROGRESS: 'badge-under_review', FILED: 'badge-approved', NOT_APPLICABLE: '' };
export const StatusBadge = ({ status }: { status: ObStatus }) => <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;

/** A due date with how far away it is: red when overdue, amber within a week. */
export function DueDate({ date, status, provisional }: { date: string; status: ObStatus; provisional?: boolean }) {
  const d = daysFrom(date);
  const hint = isDone(status) ? null : d < 0 ? <span className="overdue">{-d} day{d === -1 ? '' : 's'} late</span>
    : d === 0 ? <span className="warn-text">Today</span> : d <= 7 ? <span className="warn-text">in {d} day{d === 1 ? '' : 's'}</span> : <span className="muted">in {d} days</span>;
  return (
    <span className="nowrap">
      {fmtDate(date)}{provisional && <span className="badge sm" title="Estimated until the AGM / meeting date is recorded">est.</span>}
      {hint && <span className="block small">{hint}</span>}
    </span>
  );
}
