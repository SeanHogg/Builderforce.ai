import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * Per-tenant API rate limiting middleware.
 *
 * Uses the TenantRateLimiterDO Durable Object (one instance per tenant) for a
 * sliding-window rate limit.  Falls back gracefully if the DO binding is not
 * configured (e.g. in local dev).
 *
 * Default limits per plan (requests per minute):
 *   FREE   →  300  rpm
 *   PRO    → 1200  rpm
 *   TEAMS  → 3000  rpm
 *
 * Returns HTTP 429 with Retry-After header when the limit is exceeded.
 *
 * Usage:
 *   import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
 *   router.use('*', rateLimitMiddleware);
 */

import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { TenantPlan } from '../../domain/shared/types';
import { resolveTenantEffectivePlan } from '../../application/tenant/tenantPlanSnapshot';
import { checkSlidingWindow } from '../../application/ratelimit/slidingWindow';
import { resolveBearerTenantId } from '../routes/llmRoutes';

/** Requests-per-minute limits by plan, shared by every user and client in the tenant.
 *  Sized above normal use (a signed-in tab is ~20–24 requests on load and ~15/min idle)
 *  so the limiter stops abuse rather than throttling a busy team (operator, 2026-10-17). */
const RPM_LIMITS: Record<TenantPlan, number> = {
  [TenantPlan.FREE]:  300,
  [TenantPlan.PRO]:   1200,
  [TenantPlan.TEAMS]: 3000,
};

type RateLimitHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    TENANT_RATE_LIMITER?: DurableObjectNamespace;
  };
};

export const rateLimitMiddleware: MiddlewareHandler<RateLimitHonoEnv> = async (c, next) => {
  const env = c.env;

  // DO binding is optional — skip in dev/environments without it
  if (!env.TENANT_RATE_LIMITER) {
    return next();
  }

  // tenantId is normally NOT in context yet: index.ts mounts this app-wide, ahead of
  // the routers whose own authMiddleware sets it. So it is resolved here from the
  // request's Bearer credential. Resolution reuses the gateway's OWN
  // key resolver (`resolveBearerTenantId` → `resolveKeyCached`), so machine keys
  // (`bfk_*`/`bfa_*`/`clk_*`) get a per-tenant limit too — previously any non-JWT
  // bearer skipped the limiter entirely, leaving the metered LLM gateway
  // unthrottled. Cache-backed (KV): a hit is ~1ms and shares the same cache entry
  // the route's own auth then reuses, so this adds no extra DB round-trip on the
  // hot path. Truly anonymous callers (no bearer / unresolvable) return null and
  // fall through un-throttled — public ingest paths depend on that.
  let tenantId = (c.get as (k: string) => unknown)('tenantId') as number | undefined;
  if (!tenantId) {
    const resolved = await resolveBearerTenantId(c);
    if (resolved == null) return next(); // anonymous / unresolved — don't rate-limit
    tenantId = resolved;
  }
  if (!tenantId) return next();

  // Effective plan from the cached tenant snapshot (KV, 1h) — no DB round-trip on a
  // warm path. An unrecognised plan string falls back to FREE: an `undefined` limit
  // would make the DO's `current < limit` false and deny every request.
  let rpm = RPM_LIMITS[TenantPlan.FREE];
  try {
    rpm = RPM_LIMITS[await resolveTenantEffectivePlan(env, tenantId)] ?? RPM_LIMITS[TenantPlan.FREE];
  } catch {
    // Lookup error — allow request through rather than block
    return next();
  }

  // Call the rate limiter DO through the shared counter — the same primitive the
  // public `/hooks/*` ingress uses, so there is one implementation of "count this
  // request against a bucket" rather than two that can drift.
  try {
    const data = await checkSlidingWindow(env, String(tenantId), rpm);
    if (!data) return next();

    // Always set rate limit headers
    c.header('X-RateLimit-Limit',     String(data.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, data.limit - data.current)));
    c.header('X-RateLimit-Reset',     data.resetAt);

    if (!data.allowed) {
      c.header('Retry-After', String(data.retryAfterSeconds));
      return c.json(
        { error: 'Rate limit exceeded. Please slow down.', resetAt: data.resetAt },
        429,
      );
    }
  } catch (error) {
    // DO unavailable — allow request through
  
    reportCaughtError(error, { source: "presentation/middleware/rateLimitMiddleware.ts", operation: "rateLimitMiddleware" });
  }

  return next();
};
