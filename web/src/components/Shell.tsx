/** The signed-in frame: VendorGate's AppFrame (same sidebar, top bar and groups) with this product's menu. */
import { Outlet, useNavigate } from 'react-router-dom';
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
    ]),
    group('clients', 'Clients', 'clients', [
      { to: '/clients', label: 'All clients', icon: 'clients', end: true, show: can('clients.view') },
      { to: '/clients/import', label: 'Import from Excel', icon: 'upload', show: can('clients.manage') },
    ]),
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
      <Outlet />
    </AppFrame>
  );
}
