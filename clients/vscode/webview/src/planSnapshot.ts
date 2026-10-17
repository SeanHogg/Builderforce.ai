/**
 * The tenant's plan + month-to-date allowance (+ 30-day spend & savings), read through
 * the ONE shared cache.
 *
 * The cache itself is brain-ui's `consumptionSnapshot` — the same one the `/` menu's
 * Status tab (`WorkStatusPanel`) subscribes to — so the Status tab, the diagnostics
 * copy and the headless probe can never report two different plans. This module only
 * keeps the names the editor's callers (the chat's Copy button, the error banner's
 * upgrade links, `harness/probe.ts`) already import.
 */

import {
  fetchConsumptionSnapshot,
  invalidateConsumptionSnapshot,
  type ConsumptionSnapshot,
} from '@seanhogg/builderforce-brain-ui';
import type { AuthedFetch } from './authedFetch';

export function fetchPlanSnapshot(apiReq: AuthedFetch, forceRefresh = false): Promise<ConsumptionSnapshot | null> {
  return fetchConsumptionSnapshot(apiReq, forceRefresh);
}

/** Drop the cached plan — after an upgrade click the user may come back on another tier. */
export function invalidatePlanSnapshot(): void {
  invalidateConsumptionSnapshot();
}
