/**
 * Compliance rules — one page for a firm (Administration → Compliance rules) and for Integrata (Platform → Built-in rules).
 * Firm: built-in rules (as shipped or as changed by Integrata) with its own changes and its own rules.
 * Integrata: the built-in rules every firm starts from.
 */
import { useState } from 'react';
import { useLoad, useMeta } from '../../lib/hooks';
import { Alert, Spinner } from '../../components/ui';
import { RuleEditor, appliesText, dueText, feeText, type Rule } from '../../components/RuleEditor';
import { RulesGuide } from '../../components/RulesGuide';
import { useSession } from '../../lib/session';

type Row = Rule & { builtIn?: Rule | null; origin?: 'BUILT_IN' | 'INTEGRATA' | 'CHANGED' | 'OWN'; inCatalogue?: boolean; catalogue?: Rule | null; firmsChanged?: number };

const ORIGIN: Record<string, [string, string]> = {
  BUILT_IN: ['', ''], INTEGRATA: ['Updated by Integrata', 'badge-invited'], CHANGED: ['Changed by your firm', 'badge-under_review'], OWN: ['Your own rule', 'badge-approved'],
};

export function Rules({ platform = false }: { platform?: boolean }) {
  const endpoint = platform ? '/platform/rules' : '/admin/rules';
  const { data, error, reload } = useLoad<Row[]>(endpoint);
  const flags = useMeta()?.flags ?? {};
  const [open, setOpen] = useState<Row | 'new'>();
  const [guide, setGuide] = useState(false);
  const { can } = useSession();
  const canEdit = platform || can('rules.manage');
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{platform ? 'Built-in compliance rules' : 'Compliance rules'}</h1>
          <p className="muted">{platform ? 'What every firm starts from. A change here reaches every firm at once — except where a firm has its own version of that rule.' : 'What your calendar is worked out from. Changes apply to all your clients straight away.'}</p></div>
        <div className="head-actions">
          <button className="btn btn-secondary" onClick={() => setGuide(!guide)}>{guide ? 'Hide the guide' : 'How dates are worked out'}</button>
          {canEdit && <button className="btn btn-primary" onClick={() => setOpen('new')}>Add a rule</button>}
        </div>
      </div>
      {guide && <RulesGuide />}
      <Alert kind="warning">Built-in rules follow the Companies Act, 2013 and its rules as at November 2026 (including the 3-yearly DIR-3 KYC from 31 March 2026). Have them confirmed by a practising Company Secretary before relying on them.</Alert>
      {error && <Alert kind="error">{error}</Alert>}
      <section className="card">
        {!data ? <Spinner /> : (
          <div className="table-wrap"><table className="table compact">
            <thead><tr><th>Form</th><th>Applies to</th><th>Due</th><th>Late fee</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.code} onClick={() => setOpen(r)}>
                <td><strong>{r.form}</strong><span className="muted small block">{r.title}{r.law && ` · ${r.law}`}</span></td>
                <td className="small">{appliesText(r, flags)}</td>
                <td className="small">{dueText(r.due)}</td>
                <td className="small">{feeText(r.lateFee)}</td>
                <td className="small">
                  {!r.active && <span className="badge">Off</span>}
                  {!platform && r.origin && ORIGIN[r.origin][0] && <span className={`badge ${ORIGIN[r.origin][1]}`}>{ORIGIN[r.origin][0]}</span>}
                  {platform && r.source === 'PLATFORM' && <span className="badge badge-invited">{r.inCatalogue ? 'Changed by Integrata' : 'Added by Integrata'}</span>}
                  {platform && !!r.firmsChanged && <span className="muted block">{r.firmsChanged} firm{r.firmsChanged === 1 ? ' has its' : 's have their'} own version</span>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {open && (
        <RuleEditor
          rule={open === 'new' ? undefined : open} isNew={open === 'new'} endpoint={endpoint} flags={flags} readOnly={!canEdit}
          base={open === 'new' ? null : platform ? (open.source === 'PLATFORM' ? open.catalogue : null) : open.origin === 'CHANGED' ? open.builtIn : null}
          resetLabel={open === 'new' ? undefined : platform ? (open.source === 'PLATFORM' ? (open.inCatalogue ? 'Back to the rule as shipped' : 'Delete this rule') : undefined)
            : open.origin === 'CHANGED' ? 'Back to the built-in rule' : open.origin === 'OWN' ? 'Delete this rule' : undefined}
          note={open !== 'new' && platform && open.firmsChanged ? `${open.firmsChanged} firm(s) use their own version of this rule; your change won’t reach them until they go back to the built-in rule.` : undefined}
          onClose={() => setOpen(undefined)} onSaved={reload} />
      )}
    </div>
  );
}
