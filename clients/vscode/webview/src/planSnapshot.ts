/**
 * The tenant's plan + month-to-date allowance, read through one shared cache.
 *
 * Split out of `accountPlan.tsx` (which owns the React chip and the upgrade
 * navigation) so this half stays free of React and of the webview bridge. The
 * headless probe assembles the SAME diagnostics block the chat's Copy button does,
 * and "what plan is this tenant on, with how much allowance left" is one of the first
 * lines of that block — it must come from this cache, not a second fetch that could
 * report something different.
 */

import type { AuthedFetch } from './authedFetch';
import type { ChatDiagnosticsPlanSnapshot } from '@seanhogg/builderforce-brain-embedded';

/**
 * `GET /api/consumption` — plan, month-to-date allowance per metered resource, and the
 * server-resolved plan FEATURES. Open to any tenant-scoped JWT (no role gate), so the
 * VSIX token can read it.
 *
 * It is the shared diagnostics type, not a copy of it. This was a hand-maintained
 * duplicate that had already drifted: the response carries `features` (which decides,
 * among other things, whether a cloud run gets a container with a shell), the shape here
 * did not declare it, so the field was fetched, typed away, and never reported — the
 * value was on the wire the whole time. The alias makes that class of drift impossible.
 */
export type PlanSnapshot = ChatDiagnosticsPlanSnapshot;

/**
 * Read-through cache for the plan snapshot. Every mounted surface (the header
 * chip, the diagnostics copy) shares ONE fetch rather than each hitting the
 * endpoint: the plan changes on a billing event, not per render. The server
 * caches it for 60s, so this mirrors that TTL and invalidates by simply expiring.
 */
const PLAN_TTL_MS = 60_000;
let planCache: { ts: number; data: PlanSnapshot | null } | null = null;
let planInFlight: Promise<PlanSnapshot | null> | null = null;

export function fetchPlanSnapshot(apiReq: AuthedFetch, forceRefresh = false): Promise<PlanSnapshot | null> {
  if (!forceRefresh && planCache && Date.now() - planCache.ts < PLAN_TTL_MS) {
    return Promise.resolve(planCache.data);
  }
  // Coalesce concurrent callers (header chip + a diagnostics copy in the same tick)
  // onto a single request.
  if (!forceRefresh && planInFlight) return planInFlight;
  planInFlight = apiReq<PlanSnapshot>('/api/consumption')
    .then((data) => {
      planCache = { ts: Date.now(), data };
      return data;
    })
    .catch(() => {
      // A failed read must not pin a "no plan" answer for a minute — leave the
      // cache alone so the next mount retries.
      return null;
    })
    .finally(() => {
      planInFlight = null;
    });
  return planInFlight;
}

/** Drop the cached plan so the next read re-fetches — call after an upgrade click,
 *  since the user may come back on a different tier. */
export function invalidatePlanSnapshot(): void {
  planCache = null;
}

/** The cached snapshot, if one is warm — the seed a subscribing component renders
 *  before its first fetch resolves. */
export function cachedPlanSnapshot(): PlanSnapshot | null {
  return planCache?.data ?? null;
}
