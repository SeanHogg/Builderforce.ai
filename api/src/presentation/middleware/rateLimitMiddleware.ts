/**
 * Per-tenant API rate limiting middleware.
 *
 * Uses the TenantRateLimiterDO Durable Object (one instance per tenant) for a
 * sliding-window rate limit.  Falls back gracefully if the DO binding is not
 * configured (e.g. in local dev).
 *
 * Default limits per plan (requests per minute):
 *   FREE   →   60  rpm
 *   PRO    →  300  rpm
 *   TEAMS  → 1000  rpm
 *
 * Returns HTTP 429 with Retry-After header when the limit is exceeded.
 *
 * Usage:
 *   import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
 *   router.use('*', rateLimitMiddleware);
 */

import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { tenants } from '../../infrastructure/database/schema';
import { buildDatabase } from '../../infrastructure/database/connection';
import { resolveBearerTenantId } from '../routes/llmRoutes';

/** Requests-per-minute limits by plan. */
const RPM_LIMITS: Record<TenantPlan, number> = {
  [TenantPlan.FREE]:  60,
  [TenantPlan.PRO]:   300,
  [TenantPlan.TEAMS]: 1000,
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

  // tenantId may already be in context (if authMiddleware ran first), else resolve
  // it from the request's Bearer credential. Resolution reuses the gateway's OWN
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

  // Look up effective plan for this tenant
  let rpm = RPM_LIMITS[TenantPlan.FREE];
  try {
    const db = buildDatabase(env);
    const [row] = await db
      .select({ plan: tenants.plan, billingStatus: tenants.billingStatus, trialEndsAt: tenants.trialEndsAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (row) {
      const effectivePlan = resolveEffectivePlan({
        plan: (row.plan as TenantPlan) ?? TenantPlan.FREE,
        billingStatus: (row.billingStatus as TenantBillingStatus) ?? TenantBillingStatus.NONE,
        trialEndsAt: row.trialEndsAt ?? null,
      });
      rpm = RPM_LIMITS[effectivePlan];
    }
  } catch {
    // DB error — allow request through rather than block
    return next();
  }

  // Call the rate limiter DO
  try {
    const stub = env.TENANT_RATE_LIMITER.get(
      env.TENANT_RATE_LIMITER.idFromName(String(tenantId)),
    );
    const res = await stub.fetch(new Request('https://internal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: rpm, windowMs: 60_000 }),
    }));
    const data = await res.json<{
      allowed: boolean;
      current: number;
      limit: number;
      resetAt: string;
    }>();

    // Always set rate limit headers
    c.header('X-RateLimit-Limit',     String(data.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, data.limit - data.current)));
    c.header('X-RateLimit-Reset',     data.resetAt);

    if (!data.allowed) {
      const retryAfterSec = Math.ceil(
        (new Date(data.resetAt).getTime() - Date.now()) / 1000,
      );
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        { error: 'Rate limit exceeded. Please slow down.', resetAt: data.resetAt },
        429,
      );
    }
  } catch {
    // DO unavailable — allow request through
  }

  return next();
};
