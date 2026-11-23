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
import { Dashboard } from './pages/Dashboard';
import { Calendar } from './pages/Calendar';
import { Clients } from './pages/Clients';
import { ClientDetail } from './pages/ClientDetail';
import { ImportClients } from './pages/ImportClients';
import { Rules } from './pages/admin/Rules';
import { Users } from './pages/admin/Users';
import { Audit } from './pages/admin/Audit';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireStaff><Shell /></RequireStaff>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/import" element={<ImportClients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/admin/rules" element={<Rules />} />
            <Route path="/admin/users" element={<Users />} />
            <Route path="/admin/audit" element={<Audit />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
