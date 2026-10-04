/**
 * The daily media-credit gate shared by image and video generation. Returns a
 * blocking 429 when generating `requested` more units would pass the tenant's
 * daily allowance, else null — gated BEFORE dispatch so an over-budget tenant
 * never incurs a vendor call. Best-effort: a query error fails OPEN
 * (availability over a perfectly precise cap), matching the other usage gates.
 */

import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import { mediaCreditExceeded, mediaUnitsUsedTodayIn, type MediaCreditKind } from '../../application/llm/mediaCredits';
import { secondsUntilNextUtcMidnight } from '../../application/llm/tokenUsage';
import type { TenantAccess } from './llmRoutes';

export interface MediaCreditPolicy extends MediaCreditKind {
  /** Stable machine code on the 429, e.g. `image_credit_limit_exceeded`. */
  code: string;
  /** Daily allowance for this tenant; -1 = unlimited. */
  dailyLimit: (access: TenantAccess) => number;
  /** The refusal sentence, naming the limit in this kind's own unit. */
  message: (limit: number, access: TenantAccess) => string;
}

export async function enforceMediaCreditCap(
  c: Context<HonoEnv>,
  access: TenantAccess,
  policy: MediaCreditPolicy,
  requested = 1,
): Promise<Response | null> {
  if (access.isSuperadmin) return null;
  const limit = policy.dailyLimit(access);
  if (limit < 0) return null;
  try {
    const used = await mediaUnitsUsedTodayIn(c.env, access.tenantId, policy);
    if (!mediaCreditExceeded(limit, used, requested)) return null;
    const retryAfter = secondsUntilNextUtcMidnight();
    return c.json({
      error: policy.message(limit, access),
      code: policy.code,
      plan: access.effectivePlan,
      dailyLimit: limit,
      usedToday: used,
      terminal: true,
      retryAfter,
    }, 429, { 'Retry-After': String(retryAfter) });
  } catch {
    return null; // fail open
  }
}

/** The upgrade nudge every media refusal appends on the free plan. */
export function freePlanUpgradeHint(access: TenantAccess, noun: string): string {
  return access.effectivePlan === 'free' ? ` Upgrade to Pro at builderforce.ai/pricing for a higher ${noun} budget.` : '';
}
