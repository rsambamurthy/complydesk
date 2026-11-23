/** Fetch wrapper (same as VendorGate): cookie auth, X-Requested-With for the CSRF check, field errors in `details`. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string>) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'fetch', ...(opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? (res.status >= 500 ? 'Can’t reach the server.' : `Request failed (${res.status})`), json.details);
  return json as T;
}

export const lastWorkspace = {
  get: () => { try { return localStorage.getItem('cd.workspace') ?? ''; } catch { return ''; } },
  set: (w: string) => { try { localStorage.setItem('cd.workspace', w); } catch { /* ignore */ } },
};
