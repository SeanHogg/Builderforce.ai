/**
 * TenantRateLimiterDO — Cloudflare Durable Object for per-tenant API rate limiting.
 *
 * Uses a sliding window algorithm (1-minute window by default).
 * One DO instance per tenant, keyed by tenantId.
 *
 * HTTP interface (internal only — called by rateLimitMiddleware):
 *
 *   POST /check
 *     Body: { tenantId: number, limit: number, windowMs?: number }
 *     Response: { allowed: boolean, current: number, limit: number, resetAt: string }
 *
 * The DO stores a Map of timestamp buckets (1-second granularity) and evicts
 * buckets outside the sliding window on each check call.
 */

export class TenantRateLimiterDO {
  private state: DurableObjectState;
  /** Map<second_bucket (unix seconds), request_count> */
  private counts: Map<number, number> = new Map();
  private loaded = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async loadCounts(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get<Record<string, number>>('counts');
    if (stored) {
      for (const [k, v] of Object.entries(stored)) {
        this.counts.set(Number(k), v);
      }
    }
    this.loaded = true;
  }

  private async saveCounts(): Promise<void> {
    const obj: Record<string, number> = {};
    for (const [k, v] of this.counts) {
      obj[String(k)] = v;
    }
    await this.state.storage.put('counts', obj);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/check') {
      return new Response('Not found', { status: 404 });
    }

    const body = await request.json<{
      limit:    number;
      windowMs?: number;
    }>();

    const windowMs = body.windowMs ?? 60_000; // default: 1 minute
    const limit    = body.limit;

    await this.loadCounts();

    const nowMs      = Date.now();
    const windowSec  = Math.ceil(windowMs / 1000);
    const nowSec     = Math.floor(nowMs / 1000);
    const windowStart = nowSec - windowSec + 1;

    // Evict stale buckets
    for (const bucket of this.counts.keys()) {
      if (bucket < windowStart) this.counts.delete(bucket);
    }

    // Count requests in the current window
    let current = 0;
    for (const [bucket, count] of this.counts) {
      if (bucket >= windowStart) current += count;
    }

    const allowed = current < limit;

    if (allowed) {
      // Increment current second
      this.counts.set(nowSec, (this.counts.get(nowSec) ?? 0) + 1);
      await this.saveCounts();
    }

    const resetAt = new Date((windowStart + windowSec) * 1000).toISOString();

    return Response.json({ allowed, current: allowed ? current + 1 : current, limit, resetAt });
  }
}
