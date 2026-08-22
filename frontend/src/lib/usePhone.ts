'use client';

import { useCallback, useEffect, useState } from 'react';
import { useOptionalAuth } from '@/lib/AuthContext';
import { fetchPhoneOverview, type PhoneOverview } from '@/lib/phoneApi';
import { getOrSetClientCached, invalidateClientCache, readClientCached } from '@/infrastructure/http/readThrough';

/**
 * The shared phone snapshot — one fetch behind every phone surface.
 *
 * Modelled on {@link usePoints}, for the identical reason: the balance card, the
 * number list, the composer and the rate card all mount together, and each one
 * needs the SAME three facts (is the add-on live, what is the balance, which
 * numbers exist). Without a shared read-through they would fire four identical
 * requests and could disagree about the balance for a TTL — and "disagree about
 * the balance" on a metered product is a support ticket.
 *
 * 30s TTL, matching the server's own cache on the balance. Every write
 * invalidates explicitly: the moment after somebody spends or tops up is the one
 * moment a stale balance is unacceptable.
 *
 * Returns null until there is a tenant session and a successful fetch, so every
 * phone component can self-hide rather than take a `canShow` prop.
 */

const PHONE_TTL_MS = 30_000;
const PHONE_CACHE_KEY = 'phone:overview';

const subscribers = new Set<(s: PhoneOverview | null) => void>();

export function fetchSharedPhoneOverview(): Promise<PhoneOverview | null> {
  return getOrSetClientCached(PHONE_CACHE_KEY, () => fetchPhoneOverview(), { ttlMs: PHONE_TTL_MS })
    .then((data) => {
      subscribers.forEach((fn) => fn(data));
      return data;
    })
    // A failed read must not pin "no phone service" for half a minute — leave the
    // cache alone so the next mount retries.
    .catch(() => null);
}

export function invalidatePhone(): void {
  invalidateClientCache(PHONE_CACHE_KEY);
}

export interface UsePhoneResult {
  overview: PhoneOverview | null;
  /** Re-read after a write. Every phone surface refreshes together because they
   *  all subscribe to the same snapshot. */
  refresh: () => Promise<void>;
}

export function usePhone(): UsePhoneResult {
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;
  const [overview, setOverview] = useState<PhoneOverview | null>(
    readClientCached<PhoneOverview>(PHONE_CACHE_KEY, PHONE_TTL_MS) ?? null,
  );

  useEffect(() => {
    if (!hasTenant) return;
    let active = true;
    const notify = (s: PhoneOverview | null) => { if (active) setOverview(s); };
    subscribers.add(notify);
    void fetchSharedPhoneOverview().then(notify);
    return () => { active = false; subscribers.delete(notify); };
  }, [hasTenant]);

  const refresh = useCallback(async () => {
    invalidatePhone();
    await fetchSharedPhoneOverview();
  }, []);

  return { overview: hasTenant ? overview : null, refresh };
}
