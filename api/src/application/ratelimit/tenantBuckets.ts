/**
 * The per-tenant rate-limit BUCKETS — plan allowances and bucket keys, shared by
 * the request middleware and the one handler that spends a fan-out budget itself.
 *
 * A tenant has three independent sliding windows, each a hard cap:
 *
 *   `${tenantId}`           every counted request            1× plan rpm
 *   `${tenantId}:board`     board fan-out writes             4× plan rpm
 *   `${tenantId}:dispatch`  directed-agent replies + mention 1× plan rpm (in UNITS:
 *                           notifies spent by a chat turn     one per agent/human)
 *
 * TOTAL CEILING (decision, 2026-10-19): board writes are deliberately NOT also
 * counted against the tenant key — doing so would put the twelve-ticket fan-out
 * back into the window a human tab shares, which is the outage the board bucket
 * exists to prevent. So a tenant's request ceiling is 5× plan rpm (1× ordinary +
 * 4× board), plus the dispatch window's 1× in billable units. Each window is
 * independently capped; none is an exemption.
 */
import type { Env } from '../../env';
import { TenantPlan } from '../../domain/shared/types';
import { resolveTenantEffectivePlan } from '../tenant/tenantPlanSnapshot';
import { checkSlidingWindow, type RateLimitVerdict, type SlidingWindowEnv } from './slidingWindow';

/** Requests-per-minute limits by plan, shared by every user and client in the tenant.
 *  Sized above normal use (a signed-in tab is ~20–24 requests on load and ~15/min idle)
 *  so the limiter stops abuse rather than throttling a busy team (operator, 2026-10-17). */
export const RPM_LIMITS: Record<TenantPlan, number> = {
  [TenantPlan.FREE]:  300,
  [TenantPlan.PRO]:   1200,
  [TenantPlan.TEAMS]: 3000,
};

/** Board fan-out allowance as a multiple of the plan rpm (FREE 1200, PRO 4800, TEAMS 12000). */
export const BOARD_RPM_MULTIPLIER = 4;

/** Chat-turn dispatch allowance (units/min) as a multiple of the plan rpm. */
export const DISPATCH_RPM_MULTIPLIER = 1;

export const tenantBucketKey = (tenantId: number): string => String(tenantId);
export const boardBucketKey = (tenantId: number): string => `${tenantId}:board`;
export const dispatchBucketKey = (tenantId: number): string => `${tenantId}:dispatch`;

/** The tenant's plan rpm; an unrecognised plan string falls back to FREE (an
 *  `undefined` limit would make the DO deny every request). Throws on lookup error. */
export async function resolvePlanRpm(env: Env, tenantId: number): Promise<number> {
  return RPM_LIMITS[await resolveTenantEffectivePlan(env, tenantId)] ?? RPM_LIMITS[TenantPlan.FREE];
}

/**
 * Spend `units` of the tenant's dispatch window — one unit per directed agent reply
 * (an LLM call) and per mention notify (in-app + email) a chat turn fans out.
 * Null when there is no limiter binding (fail open, like every bucket).
 */
export async function consumeDispatchBudget(
  env: Env & SlidingWindowEnv,
  tenantId: number,
  units: number,
): Promise<RateLimitVerdict | null> {
  if (units <= 0) return null;
  const rpm = await resolvePlanRpm(env, tenantId);
  return checkSlidingWindow(env, dispatchBucketKey(tenantId), rpm * DISPATCH_RPM_MULTIPLIER, 60_000, units);
}
