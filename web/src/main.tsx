import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, RequireStaff } from './lib/session';
import { Shell } from './components/Shell';
import { Login } from './pages/Login';
import { Signup, VerifyEmail } from './pages/Signup';
import { Platform } from './pages/Platform';
import { Meetings } from './pages/Meetings';
import { MeetingDetail } from './pages/MeetingDetail';
import { MeetingPrint } from './pages/MeetingPrint';
import { RegisterPrint } from './pages/RegisterPrint';
import { Billing } from './pages/Billing';
import { Regulatory } from './pages/Regulatory';
import { PlatformRegUpdates } from './pages/PlatformRegUpdates';
import { InvoiceDetail } from './pages/InvoiceDetail';
import { InvoicePrint } from './pages/InvoicePrint';
import { ClientReport } from './pages/ClientReport';
import { Dashboard } from './pages/Dashboard';
import { Calendar } from './pages/Calendar';
import { Clients } from './pages/Clients';
import { ClientDetail } from './pages/ClientDetail';
import { ImportClients } from './pages/ImportClients';
import { Rules } from './pages/admin/Rules';
import { Users } from './pages/admin/Users';
import { Audit } from './pages/admin/Audit';
import { Settings } from './pages/admin/Settings';
import { FormPack } from './pages/FormPack';
import { Help } from './pages/Help';
import { Extension } from './pages/Extension';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/meetings/:id/print/:doc" element={<RequireStaff><MeetingPrint /></RequireStaff>} />
          <Route path="/clients/:id/registers/:code/print" element={<RequireStaff><RegisterPrint /></RequireStaff>} />
          <Route path="/billing/invoices/:id/print" element={<RequireStaff><InvoicePrint /></RequireStaff>} />
          <Route path="/clients/:id/report" element={<RequireStaff><ClientReport /></RequireStaff>} />
          <Route element={<RequireStaff><Shell /></RequireStaff>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/meetings" element={<Meetings />} />
            <Route path="/meetings/:id" element={<MeetingDetail />} />
            <Route path="/filings/:id/form" element={<FormPack />} />
            <Route path="/extension" element={<Extension />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/regulatory" element={<Regulatory />} />
            <Route path="/platform/updates" element={<PlatformRegUpdates />} />
            <Route path="/billing/invoices/:id" element={<InvoiceDetail />} />
            <Route path="/help" element={<Help />} />
            <Route path="/help/:id" element={<Help />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/import" element={<ImportClients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/admin/rules" element={<Rules />} />
            <Route path="/admin/users" element={<Users />} />
            <Route path="/admin/audit" element={<Audit />} />
            <Route path="/admin/settings" element={<Settings />} />
            <Route path="/platform" element={<Platform />} />
            <Route path="/platform/rules" element={<Rules platform />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
