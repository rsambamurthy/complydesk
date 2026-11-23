import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExcelImportModal } from '../components/ExcelImport';
import { Alert } from '../components/ui';

interface Row { row: number; sheet: string; cin: string; name: string; detail: string }

/** Bulk import: VendorGate's two-step Excel import (check, then import) over the clients workbook. */
export function ImportClients() {
  const nav = useNavigate();
  const [done, setDone] = useState<number>();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Import clients from Excel</h1><p className="muted">Clients, their directors & KMP and shareholders in one workbook.</p></div></div>
      {done !== undefined && <Alert kind="success">{done} records imported. Every client’s compliance calendar has been worked out.</Alert>}
      <ExcelImportModal<Row>
        title="Import clients"
        intro="Download the template, fill in the three sheets (directors and shareholders are matched to clients by CIN), then check the file. Nothing is saved until you press Import."
        templateUrl="/import/template"
        endpoint="/import"
        columns={[{ label: 'Sheet', cell: (r) => r.sheet }, { label: 'CIN', cell: (r) => <span className="mono small">{r.cin}</span> }, { label: 'Name', cell: (r) => r.name }, { label: '', cell: (r) => <span className="muted small">{r.detail}</span> }]}
        onClose={() => nav('/clients')}
        onDone={(n) => setDone(n)}
      />
    </div>
  );
}
