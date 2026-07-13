'use client';

/**
 * Shared loader + hook for the psychometric catalog (framework/dimension labels,
 * questionnaire bank, enneagram types, Pro entitlement).
 *
 * The catalog is a static server constant, so it is fetched at most ONCE per
 * session and memoised at module scope — every consumer (the personality editor
 * AND the read-only summary) shares the same in-flight/resolved promise instead
 * of each firing its own request.
 */
import { useEffect, useState } from 'react';
import { psychometric as psychometricApi } from '@/lib/builderforceApi';
import { useAuth } from '@/lib/AuthContext';
import type { PsychometricCatalog } from '@/lib/psychometric';

// Keyed by tenant id: the frameworks/questions are static, but `entitled` is
// per-tenant, so a tenant switch must NOT reuse another tenant's entitlement.
const cache = new Map<string, Promise<PsychometricCatalog>>();

/** Fetch the catalog once per tenant and reuse it. On failure the entry is cleared
 *  so a later mount can retry. */
export function loadPsychometricCatalog(tenantKey: string): Promise<PsychometricCatalog> {
  let p = cache.get(tenantKey);
  if (!p) {
    p = psychometricApi.catalog().catch((e) => {
      cache.delete(tenantKey);
      throw e;
    });
    cache.set(tenantKey, p);
  }
  return p;
}

export interface UsePsychometricCatalog {
  catalog: PsychometricCatalog | null;
  loading: boolean;
  error: string;
}

/** React hook over {@link loadPsychometricCatalog}, scoped to the active tenant. */
export function usePsychometricCatalog(): UsePsychometricCatalog {
  const { tenant } = useAuth();
  const tenantKey = tenant?.id ?? 'none';
  const [catalog, setCatalog] = useState<PsychometricCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    loadPsychometricCatalog(tenantKey)
      .then((c) => { if (alive) setCatalog(c); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load catalog'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tenantKey]);

  return { catalog, loading, error };
}
