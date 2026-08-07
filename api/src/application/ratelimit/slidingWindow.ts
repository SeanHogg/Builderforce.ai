/**
 * The ONE sliding-window counter.
 *
 * `TenantRateLimiterDO` is keyed by name and knows nothing about tenants — the
 * name is the bucket. That makes it reusable for any subject we need to throttle,
 * and this module is the single place that knows how to talk to it, so a second
 * caller does not re-derive the request shape, the fail-open posture, or the
 * header names.
 *
 * ── FAIL OPEN, DELIBERATELY ─────────────────────────────────────────────────
 * If the binding is missing (local dev) or the DO is unreachable, the check
 * ALLOWS. A rate limiter that fails closed converts one unavailable dependency
 * into a total outage of every path that consults it — including live webhook
 * delivery, where a rejected request is a dropped phone call. The limiter exists
 * to cap abuse, not to be a second point of failure in front of the product.
 */

export interface RateLimitVerdict {
  allowed: boolean;
  current: number;
  limit: number;
  /** ISO timestamp at which the current window empties. */
  resetAt: string;
  /** Whole seconds until `resetAt`, floored at 1 — the `Retry-After` value. */
  retryAfterSeconds: number;
}

export interface SlidingWindowEnv {
  TENANT_RATE_LIMITER?: DurableObjectNamespace;
}

/**
 * Count one request against `key` and say whether it is allowed.
 *
 * `key` names the DO instance, so it also names the bucket: `"41"` is tenant 41,
 * `"ingress:<token>"` is one project's public front door. Two subjects that must
 * not share a budget must not share a key.
 */
export async function checkSlidingWindow(
  env: SlidingWindowEnv,
  key: string,
  limit: number,
  windowMs = 60_000,
): Promise<RateLimitVerdict | null> {
  const namespace = env.TENANT_RATE_LIMITER;
  if (!namespace) return null;

  const stub = namespace.get(namespace.idFromName(key));
  const res = await stub.fetch(
    new Request('https://internal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, windowMs }),
    }),
  );
  const data = await res.json<{ allowed: boolean; current: number; limit: number; resetAt: string }>();

  return {
    ...data,
    retryAfterSeconds: Math.max(1, Math.ceil((new Date(data.resetAt).getTime() - Date.now()) / 1000)),
  };
}
