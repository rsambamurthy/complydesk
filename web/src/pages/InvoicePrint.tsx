/** Printable invoice (A4) — opens in its own tab; the browser's Print saves it as PDF. */
import { useParams } from 'react-router-dom';
import { useLoad } from '../lib/hooks';
import { fmtDate, money2 } from '../lib/format';
import { Spinner, Alert } from '../components/ui';
import type { Invoice } from './InvoiceDetail';

export function InvoicePrint() {
  const { id } = useParams();
  const { data: i, error } = useLoad<Invoice>(`/billing/invoices/${id}`);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!i) return <Spinner />;
  const f = i.firm ?? {}; const b = i.billTo ?? {};
  const rate = Number(i.gstRate);
  return (
    <div className="inv-print">
      <style>{'html, body { background: #fff } @page { size: A4; margin: 14mm } @media print { .no-print { display: none } }'}</style>
      <div className="no-print" style={{ textAlign: 'right', marginBottom: 12 }}><button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print / save as PDF</button></div>
      {i.status === 'DRAFT' && <div className="inv-watermark">DRAFT</div>}
      {i.status === 'CANCELLED' && <div className="inv-watermark">CANCELLED</div>}
      <div className="inv-head">
        <div>
          <h2>{f.legalName || f.name}</h2>
          <div className="pre">{f.address}</div>
          {f.gstin && <div>GSTIN: <b>{f.gstin}</b></div>}
          {f.pan && <div>PAN: {f.pan}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <h1>{i.taxInvoice ? 'TAX INVOICE' : 'INVOICE'}</h1>
          <div>No. <b>{i.number ?? '(draft)'}</b></div>
          <div>Date: {fmtDate(i.date)}</div>
          <div>Due: {fmtDate(i.dueDate)}</div>
        </div>
      </div>
      <div className="inv-to">
        <div className="muted small">Bill to</div>
        <b>{b.name}</b>
        <div className="pre">{b.address}</div>
        {b.cin && <div>CIN: {b.cin}</div>}
        {b.gstin && <div>GSTIN: {b.gstin}</div>}
        <div>Place of supply: {i.placeOfSupplyName || '—'}</div>
      </div>
      <table>
        <thead><tr><th style={{ width: 30 }}>#</th><th>Description</th><th style={{ width: 80 }}>SAC</th><th style={{ width: 120, textAlign: 'right' }}>Amount (₹)</th></tr></thead>
        <tbody>
          {i.lines.map((l, k) => <tr key={k}><td>{k + 1}</td><td>{l.description}{!l.taxable && <i> (reimbursement, no GST)</i>}</td><td>{l.taxable ? l.sac ?? '' : ''}</td><td style={{ textAlign: 'right' }}>{money2(l.amount).replace('₹', '')}</td></tr>)}
        </tbody>
        <tfoot>
          <tr><td colSpan={3} style={{ textAlign: 'right' }}>Taxable value</td><td style={{ textAlign: 'right' }}>{money2(i.taxable).replace('₹', '')}</td></tr>
          {i.taxInvoice && (i.intraState ? <>
            <tr><td colSpan={3} style={{ textAlign: 'right' }}>CGST @ {rate / 2}%</td><td style={{ textAlign: 'right' }}>{money2(i.cgst).replace('₹', '')}</td></tr>
            <tr><td colSpan={3} style={{ textAlign: 'right' }}>SGST @ {rate / 2}%</td><td style={{ textAlign: 'right' }}>{money2(i.sgst).replace('₹', '')}</td></tr>
          </> : <tr><td colSpan={3} style={{ textAlign: 'right' }}>IGST @ {rate}%</td><td style={{ textAlign: 'right' }}>{money2(i.igst).replace('₹', '')}</td></tr>)}
          {Number(i.nonTaxable) > 0 && <tr><td colSpan={3} style={{ textAlign: 'right' }}>Reimbursements</td><td style={{ textAlign: 'right' }}>{money2(i.nonTaxable).replace('₹', '')}</td></tr>}
          <tr className="inv-grand"><td colSpan={3} style={{ textAlign: 'right' }}>Total</td><td style={{ textAlign: 'right' }}>{money2(i.total)}</td></tr>
        </tfoot>
      </table>
      <p><b>Amount in words:</b> {i.words}</p>
      {i.notes && <p>{i.notes}</p>}
      {f.bankDetails && <div className="inv-box"><b>Payment details</b><div className="pre">{f.bankDetails}</div></div>}
      {f.terms && <div className="inv-box small"><b>Terms</b><div className="pre">{f.terms}</div></div>}
      <div className="inv-sign">For {f.legalName || f.name}<br /><br /><br />Authorised signatory</div>
      {i.taxInvoice && <p className="small" style={{ marginTop: 18 }}>Whether tax is payable under reverse charge: No.</p>}
    </div>
  );
}
