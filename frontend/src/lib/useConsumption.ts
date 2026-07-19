'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { consumptionApi, type ConsumptionSnapshot } from '@/lib/builderforceApi';

/**
 * Shared month-to-date consumption snapshot hook (DRY) — the single fetch behind
 * every plan/usage surface (the sidebar <UsageMeter/>, the dashboard AI-usage
 * tile, the insights header, the Brain header's <PlanBadge/>), so none of them
 * re-implements the gating/fetch and all read the SAME snapshot. Returns null
 * until there's a tenant session and a successful fetch (the endpoint is
 * all-members, so no role gate here — capping is on processing, not visibility).
 *
 * Module-level read-through cache with a 60s TTL + in-flight coalescing. Several
 * of these surfaces mount together (sidebar meter + dashboard tile + a Brain
 * drawer), and the plan changes on a billing event rather than per render — so
 * without this, one page load fired N identical requests. The TTL mirrors the
 * server's own 60s cache on `GET /api/consumption`, and invalidation is simply
 * expiry plus the explicit {@link invalidateConsumption} after an upgrade click.
 */

const CONSUMPTION_TTL_MS = 60_000;

let cache: { ts: number; data: ConsumptionSnapshot } | null = null;
let inflight: Promise<ConsumptionSnapshot | null> | null = null;
/** Mounted subscribers, so a fresh fetch updates every surface at once. */
const subscribers = new Set<(s: ConsumptionSnapshot | null) => void>();

/**
 * Imperative read of the shared snapshot, for non-render callers (e.g. building a
 * diagnostics report on a button click). Same cache + coalescing as the hook, so
 * a click usually costs no request at all and can never disagree with what the
 * rendered surfaces show.
 */
export function fetchConsumptionSnapshot(): Promise<ConsumptionSnapshot | null> {
  if (cache && Date.now() - cache.ts < CONSUMPTION_TTL_MS) return Promise.resolve(cache.data);
  // Coalesce concurrent mounts onto one request.
  if (inflight) return inflight;
  inflight = consumptionApi
    .get()
    .then((data) => {
      cache = { ts: Date.now(), data };
      subscribers.forEach((fn) => fn(data));
      return data;
    })
    // A failed read must not pin a "no plan" answer for a minute — leave the
    // cache alone so the next mount retries.
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}

/** Drop the cached snapshot so the next read re-fetches — call after an upgrade
 *  click, since the user may come back on a different tier or allowance. */
export function invalidateConsumption(): void {
  cache = null;
}

export function useConsumption(): ConsumptionSnapshot | null {
  const { hasTenant } = useAuth();
  const [snapshot, setSnapshot] = useState<ConsumptionSnapshot | null>(cache?.data ?? null);

  useEffect(() => {
    if (!hasTenant) return;
    let active = true;
    const notify = (s: ConsumptionSnapshot | null) => { if (active) setSnapshot(s); };
    subscribers.add(notify);
    void fetchConsumptionSnapshot().then(notify);
    return () => { active = false; subscribers.delete(notify); };
  }, [hasTenant]);

  return hasTenant ? snapshot : null;
}
