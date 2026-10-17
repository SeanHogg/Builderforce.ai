import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveBearerTenantId = vi.fn();
const resolveTenantEffectivePlan = vi.fn();
vi.mock('../routes/llmRoutes', () => ({ resolveBearerTenantId: (...a: unknown[]) => resolveBearerTenantId(...a) }));
vi.mock('../../application/tenant/tenantPlanSnapshot', () => ({
  resolveTenantEffectivePlan: (...a: unknown[]) => resolveTenantEffectivePlan(...a),
}));

import { rateLimitMiddleware } from './rateLimitMiddleware';

/** A stand-in DO namespace that records the limit each check carried. */
function fakeLimiter(allowed = true) {
  const limits: unknown[] = [];
  const ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (req: Request) => {
        const body = (await req.json()) as { limit: number };
        limits.push(body.limit);
        return Response.json({ allowed, current: 1, limit: body.limit, resetAt: new Date(Date.now() + 30_000).toISOString() });
      },
    }),
  };
  return { ns: ns as unknown as DurableObjectNamespace, limits };
}

function app() {
  const a = new Hono();
  a.use('*', rateLimitMiddleware as never);
  a.get('/x', (c) => c.text('ok'));
  return a;
}

describe('rateLimitMiddleware', () => {
  beforeEach(() => {
    resolveBearerTenantId.mockReset();
    resolveTenantEffectivePlan.mockReset();
  });

  it('is inert without the binding', async () => {
    const res = await app().request('/x', {}, {});
    expect(res.status).toBe(200);
    expect(resolveBearerTenantId).not.toHaveBeenCalled();
  });

  it('applies the plan limit and sets headers', async () => {
    const { ns, limits } = fakeLimiter();
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockResolvedValue('pro');
    const res = await app().request('/x', {}, { TENANT_RATE_LIMITER: ns });
    expect(res.status).toBe(200);
    expect(limits).toEqual([1200]);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('1200');
  });

  it('falls back to the FREE limit for an unrecognised plan instead of denying everything', async () => {
    const { ns, limits } = fakeLimiter();
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockResolvedValue('enterprise');
    const res = await app().request('/x', {}, { TENANT_RATE_LIMITER: ns });
    expect(res.status).toBe(200);
    expect(limits).toEqual([300]);
  });

  it('returns 429 with Retry-After when the window is full', async () => {
    const { ns } = fakeLimiter(false);
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockResolvedValue('free');
    const res = await app().request('/x', {}, { TENANT_RATE_LIMITER: ns });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });

  it('lets anonymous callers through un-throttled', async () => {
    const { ns, limits } = fakeLimiter();
    resolveBearerTenantId.mockResolvedValue(null);
    const res = await app().request('/x', {}, { TENANT_RATE_LIMITER: ns });
    expect(res.status).toBe(200);
    expect(limits).toEqual([]);
  });
});

describe('wrangler.toml — the limiter is actually deployed', () => {
  const toml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../wrangler.toml'), 'utf8');

  it('binds TENANT_RATE_LIMITER to TenantRateLimiterDO', () => {
    expect(toml).toMatch(/name\s*=\s*"TENANT_RATE_LIMITER"\s*\r?\nclass_name\s*=\s*"TenantRateLimiterDO"/);
  });

  it('creates TenantRateLimiterDO as a SQLite-backed class in a migration', () => {
    expect(toml).toMatch(/new_sqlite_classes\s*=\s*\[[^\]]*"TenantRateLimiterDO"[^\]]*\]/);
  });
});
