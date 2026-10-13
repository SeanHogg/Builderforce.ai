// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useCallback, useEffect, useState } from 'react';
import type { CapabilityStateDto } from '@builderforce/interaction-contract';
import { useOptionalAuth } from '@/lib/AuthContext';
import { capabilityApi, invalidateCapabilityState, readCachedCapabilityState } from '@/lib/capabilityApi';

export interface CapabilityReading {
  /** The server's answer; null until it arrives (or with no workspace). */
  state: CapabilityStateDto | null;
  /**
   * true / false once known; null while unknown. Callers treat null as "do not
   * decide yet", so a slow read neither flashes a buy prompt at a customer nor
   * fetches data a non-customer may not read.
   */
  entitled: boolean | null;
  loading: boolean;
  error: unknown;
  /** Drop the cached answer and ask again (after an install or a purchase). */
  refresh: () => void;
}

/**
 * Does this workspace hold capability `slug`? Read once per workspace through the
 * shared read-through cache (`capabilityApi.state`), so the app header, the
 * canvas surface and the set-up flow all see the SAME answer for one request.
 * Without a workspace the answer is `entitled: false` — there is nothing to hold
 * a licence.
 */
export function useCapability(slug: string): CapabilityReading {
  const auth = useOptionalAuth();
  const hasTenant = auth?.hasTenant ?? false;
  const authReady = auth?.authReady ?? true;
  const tenantId = auth?.tenant?.id ?? null;
  const [state, setState] = useState<CapabilityStateDto | null>(() => readCachedCapabilityState(slug) ?? null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!hasTenant) { setState(null); return undefined; }
    let live = true;
    setLoading(true);
    setError(null);
    capabilityApi.state(slug)
      .then((next) => { if (live) setState(next); })
      .catch((cause: unknown) => { if (live) { setState(null); setError(cause); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [slug, hasTenant, tenantId, attempt]);

  const refresh = useCallback(() => {
    invalidateCapabilityState();
    setAttempt((n) => n + 1);
  }, []);

  const known = authReady && (!hasTenant || state !== null || error !== null);
  return {
    state: hasTenant ? state : null,
    entitled: !known ? null : hasTenant ? state?.entitled ?? false : false,
    loading: hasTenant && loading,
    error,
    refresh,
  };
}
