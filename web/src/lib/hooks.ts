import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Meta } from './types';

/** Load something from the API, with reload. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(() => {
    if (!path) return;
    api<T>(path).then((d) => { setData(d); setError(undefined); }).catch((e) => setError(e.message));
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

/** Form lists (flags, designations, event filings, staff) — loaded once per page. */
export const useMeta = () => useLoad<Meta>('/clients/meta').data;
