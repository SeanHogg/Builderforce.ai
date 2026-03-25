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
import { TenantPlan } from '../../domain/shared/types';
import { tenants } from '../../infrastructure/database/schema';
import { buildDatabase } from '../../infrastructure/database/connection';
import { verifyJwt } from '../../infrastructure/auth/JwtService';

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

  // tenantId may already be in context (if authMiddleware ran first), or extract from JWT
  let tenantId = (c.get as (k: string) => unknown)('tenantId') as number | undefined;
  if (!tenantId) {
    // Try to extract from Authorization header (best-effort, no DB lookup needed)
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : c.req.query('token');
    if (!token) return next(); // unauthenticated — don't rate-limit
    try {
      const payload = await verifyJwt(token, env.JWT_SECRET);
      if (typeof payload.tid === 'number') {
        tenantId = payload.tid;
      }
    } catch {
      return next(); // invalid token — let authMiddleware handle it
    }
  }
  if (!tenantId) return next();

  // Look up effective plan for this tenant
  let rpm = RPM_LIMITS[TenantPlan.FREE];
  try {
    const db = buildDatabase(env);
    const [row] = await db
      .select({ plan: tenants.plan, billingStatus: tenants.billingStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (row) {
      const effectivePlan: TenantPlan = row.billingStatus === 'active'
        ? (row.plan as TenantPlan)
        : TenantPlan.FREE;
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
