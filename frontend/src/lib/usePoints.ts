'use client';

import { useCallback, useEffect, useState } from 'react';
import { useOptionalAuth } from '@/lib/AuthContext';
import { fetchPointsSummary, type PointsSummary } from '@/lib/pointsApi';
import { getOrSetClientCached, invalidateClientCache, readClientCached } from '@/infrastructure/http/readThrough';

/**
 * The shared points snapshot — one fetch behind every points surface.
 *
 * Modelled on {@link useConsumption} and for the same reason: the balance chip,
 * the badge grid, the reward shelf and the activity list mount together, and
 * without a shared read-through each one would fire its own identical request and
 * they could disagree about the balance for a TTL.
 *
 * 60s TTL mirrors the server's own cache on `GET /api/points`. A redemption
 * invalidates explicitly, because the one moment a stale balance is unacceptable
 * is immediately after the user spent it.
 *
 * Returns null until there is a tenant session and a successful fetch — the hook
 * decides its own gating so no consumer has to, which is what lets every points
 * component self-hide rather than take a `canShow` prop.
 */

const POINTS_TTL_MS = 60_000;
const POINTS_CACHE_KEY = 'points:summary';

const subscribers = new Set<(s: PointsSummary | null) => void>();

export function fetchSharedPointsSummary(): Promise<PointsSummary | null> {
  return getOrSetClientCached(POINTS_CACHE_KEY, () => fetchPointsSummary(), { ttlMs: POINTS_TTL_MS })
    .then((data) => {
      subscribers.forEach((fn) => fn(data));
      return data;
    })
    // A failed read must not pin "no points" for a minute — leave the cache alone
    // so the next mount retries.
    .catch(() => null);
}

export function invalidatePoints(): void {
  invalidateClientCache(POINTS_CACHE_KEY);
}

export interface UsePointsResult {
  summary: PointsSummary | null;
  /** Re-read after a write. Every points surface refreshes together because they
   *  all subscribe to the same snapshot. */
  refresh: () => Promise<void>;
}

export function usePoints(): UsePointsResult {
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;
  const [summary, setSummary] = useState<PointsSummary | null>(
    readClientCached<PointsSummary>(POINTS_CACHE_KEY, POINTS_TTL_MS) ?? null,
  );

  useEffect(() => {
    if (!hasTenant) return;
    let active = true;
    const notify = (s: PointsSummary | null) => { if (active) setSummary(s); };
    subscribers.add(notify);
    void fetchSharedPointsSummary().then(notify);
    return () => { active = false; subscribers.delete(notify); };
  }, [hasTenant]);

  const refresh = useCallback(async () => {
    invalidatePoints();
    await fetchSharedPointsSummary();
  }, []);

  return { summary: hasTenant ? summary : null, refresh };
}
