/** The signed-in frame: VendorGate's AppFrame (same sidebar, top bar and groups) with this product's menu. */
import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { AppFrame, type FrameEntry, type FrameGroup, type FrameLink } from './AppFrame';
import { NavIcon } from './NavIcon';
import { PoweredBy, PRODUCT } from './Brand';
import { useSession } from '../lib/session';

type L = FrameLink & { show: boolean };

export function Shell() {
  const { me, can, signOut } = useSession();
  const nav = useNavigate();
  if (!me) return null;
  const keep = (items: L[]) => items.filter((i) => i.show).map(({ show: _s, ...l }) => l);
  const group = (key: string, label: string, icon: string, items: L[]): FrameGroup | null => { const k = keep(items); return k.length ? { key, label, icon, items: k } : null; };
  const entries = [
    ...keep([
      { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', show: can('clients.view') },
      { to: '/calendar', label: 'Compliance calendar', icon: 'calendar', show: can('clients.view') },
      { to: '/meetings', label: 'Meetings', icon: 'meeting', show: can('clients.view') },
    ]),
    group('clients', 'Clients', 'clients', [
      { to: '/clients', label: 'All clients', icon: 'clients', end: true, show: can('clients.view') },
      { to: '/clients/import', label: 'Import from Excel', icon: 'upload', show: can('clients.manage') },
    ]),
    me.platformAdmin ? group('platform', 'Integrata platform', 'shield', [
      { to: '/platform', label: 'Firms & sign-up', icon: 'shield', end: true, show: true },
      { to: '/platform/rules', label: 'Built-in rules', icon: 'rules', show: true },
    ]) : null,
    group('admin', 'Administration', 'config', [
      { to: '/admin/rules', label: 'Compliance rules', icon: 'rules', show: can('clients.view') },
      { to: '/admin/users', label: 'Users', icon: 'users', show: can('users.manage') },
      { to: '/admin/audit', label: 'Audit log', icon: 'audit', show: can('audit.view') },
    ]),
  ].filter(Boolean) as FrameEntry[];
  const initials = me.user.name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return (
    <AppFrame
      prefsKey="cd.nav"
      product={PRODUCT}
      workspace={me.tenant.name}
      entries={entries}
      navLabel="Navigation"
      menuLabels={{ open: 'Open menu', close: 'Close menu', collapse: 'Collapse sidebar', expand: 'Expand sidebar' }}
      actions={<button className="af-hbtn" onClick={async () => { await signOut(); nav('/login'); }} title="Sign out" aria-label="Sign out"><NavIcon name="logout" size={18} /></button>}
      user={{ initials, name: me.user.name, role: me.roles.map((r) => r.name).join(', ') || 'No role' }}
      sideFoot={<PoweredBy />}
    >
      <AccessBar />
      <Outlet />
    </AppFrame>
  );
}

/** Trial days left / read-only notice and the "confirm your email" reminder (VendorGate's trial-bar styles). */
function AccessBar() {
  const { me } = useSession();
  const [resent, setResent] = useState<string | boolean>(false);
  if (!me) return null;
  const a = me.access;
  return (
    <>
      {a.state === 'TRIAL' && <div className={`trial-bar ${a.daysLeft > 7 ? 'quiet' : ''}`} role="status">Free trial · {a.daysLeft} day{a.daysLeft === 1 ? '' : 's'} left{a.clientLimit ? ` · up to ${a.clientLimit} client companies` : ''} · to subscribe, write to <a href="mailto:info@integratatech.ai">info@integratatech.ai</a></div>}
      {!a.ok && <div className="trial-bar ended" role="status">{a.message}</div>}
      {!me.emailVerified && <div className="trial-bar quiet" role="status">Please confirm your email ({me.user.email}) using the link we sent. {resent === true ? 'Sent again ✓' : <><a href="#" onClick={async (e) => { e.preventDefault(); try { await api('/auth/resend-verification', { method: 'POST' }); setResent(true); } catch { setResent('We couldn’t send the email right now. Please try again later.'); } }}>Resend link</a>{typeof resent === 'string' && <span className="overdue"> {resent}</span>}</>}</div>}
    </>
  );
}
