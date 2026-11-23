import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api';
import type { Me, Permission } from './types';

interface SessionValue { me: Me | null; loading: boolean; refresh: () => Promise<Me | null>; can: (p: Permission) => boolean; signOut: () => Promise<void> }
const Ctx = createContext<SessionValue>(null!);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { const r = await api<Me>('/auth/me'); setMe(r); return r; } catch { setMe(null); return null; } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const can = useCallback((p: Permission) => !!me?.permissions.includes(p), [me]);
  const signOut = useCallback(async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setMe(null); }, []);
  return <Ctx.Provider value={{ me, loading, refresh, can, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

export function RequireStaff({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <div className="center-page"><div className="spinner" /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}
