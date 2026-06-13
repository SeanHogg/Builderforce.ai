'use client';

import { useEffect, useState } from 'react';

export interface PmAsync<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-run the loader (e.g. after a mutation). */
  reload: () => void;
}

/**
 * Tiny load-on-deps helper shared by the PM visualizers — one place for the
 * mounted-guard + error capture so each component doesn't re-inline a useEffect.
 * Pass a stable `deps` array (scope/projectId/etc.); the loader re-runs when they
 * change or `reload()` is called.
 *
 * Stale results are dropped by tagging each settle with the request `key`: when
 * deps change, the previously-loaded state no longer matches the current key, so
 * the hook reports `loading` again without a synchronous setState in the effect.
 */
export function usePmData<T>(loader: () => Promise<T>, deps: unknown[]): PmAsync<T> {
  const [tick, setTick] = useState(0);
  const key = `${JSON.stringify(deps)}:${tick}`;
  const [settled, setSettled] = useState<{ key: string; data: T | null; error: string | null }>({
    key: '',
    data: null,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    loader()
      .then((d) => { if (alive) setSettled({ key, data: d, error: null }); })
      .catch((e: unknown) => { if (alive) setSettled({ key, data: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fresh = settled.key === key;
  const data = fresh ? settled.data : null;
  const error = fresh ? settled.error : null;
  return { data, error, loading: data == null && error == null, reload: () => setTick((t) => t + 1) };
}
