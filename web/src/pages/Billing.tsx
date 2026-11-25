/** Billing: tiles, work to be billed, invoices, fees and the firm's billing details. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import { TabStrip } from '../components/TabStrip';
import { BillingTiles, FeeTable, FirmBillingForm, InvoiceTable, UnbilledWork, type Summary } from '../components/Billing';

const TABS = [['unbilled', 'To be billed'], ['invoices', 'Invoices'], ['fees', 'Fees'], ['firm', 'Firm details']] as const;

export function Billing() {
  const [qs, setQs] = useSearchParams();
  const tab = qs.get('tab') ?? 'unbilled';
  const sum = useLoad<Summary>('/billing/summary');
  const { can } = useSession();
  const [k, setK] = useState(0);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Billing</h1><p className="muted">Fees for filed work, GST invoices and what clients still owe.</p></div></div>
      <BillingTiles s={sum.data} />
      <section className="card">
        <TabStrip>{TABS.filter(([t]) => t !== 'firm' || can('billing.view')).map(([t, l]) => <button key={t} role="tab" className={tab === t ? 'active' : ''} aria-selected={tab === t} onClick={() => setQs({ tab: t }, { replace: true })}>{l}</button>)}</TabStrip>
        <div className="tab-panel pad">
          {tab === 'unbilled' && <UnbilledWork key={k} onChange={() => { sum.reload(); setK(k + 1); }} />}
          {tab === 'invoices' && <InvoiceTable />}
          {tab === 'fees' && <FeeTable />}
          {tab === 'firm' && <FirmBillingForm />}
        </div>
      </section>
    </div>
  );
}
