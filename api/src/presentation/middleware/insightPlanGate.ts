/**
 * Insight plan-gate — composes a paid-plan entitlement check into the insight
 * lens routes as a *middleware* (the lenses were role-gated only). Slots in right
 * after `requireRole(...)` so a premium lens needs BOTH the role AND the plan:
 *
 *   router.get('/finance', requireRole(MANAGER), requirePlanFeature('advancedInsights'), handler)
 *
 * Reuses the canonical {@link requireFeature} gate (→ 402 upgrade_required with the
 * feature + unlocking plan named) so the wall copy and telemetry never drift from
 * every other paid feature.
 *
 * Fail-open safety: if the named flag isn't a known {@link PlanFeature} yet (e.g.
 * the `advancedInsights` flag hasn't been added to PlanLimits in this deploy), the
 * gate is a no-op and the lens keeps its prior role-only behaviour — so wiring the
 * gate can never dark-launch a paywall on a lens before the plan flag exists.
 */

import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { PLAN_FEATURE_LABEL, type PlanFeature } from '../../domain/tenant/planFeatures';
import { requireFeature } from './featureGate';

/**
 * Gate a route behind a paid-plan feature. `feature` is taken as a string so a
 * not-yet-defined flag compiles cleanly at the call site; it's narrowed to a real
 * {@link PlanFeature} at runtime, and unknown flags fail open (see file header).
 */
export function requirePlanFeature(feature: string): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    if (!(feature in PLAN_FEATURE_LABEL)) return next(); // flag not defined yet → no-op
    const gate = await requireFeature(c, feature as PlanFeature);
    if (gate) return gate; // 402 upgrade_required
    return next();
  };
}
