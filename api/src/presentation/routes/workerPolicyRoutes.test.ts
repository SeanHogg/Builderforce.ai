/**
 * POST /api/runtime/worker-policy — the developer role gate, the caller-scope project gate,
 * strict body validation (the client names neither origins nor the origin key), the application id
 * bound to the project, the per-tenant mint bucket, a generic 422 for an unsignable declaration,
 * and a minted id that resolves on its own derived app origin only.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const inScope = vi.hoisted(() => vi.fn());
const limiter = vi.hoisted(() => vi.fn());
const declared = vi.hoisted(() => vi.fn());
vi.mock('../../application/security/runtimeShieldIncidents', () => ({ projectInCallerScope: inScope }));
vi.mock('../../application/ratelimit/slidingWindow', () => ({ checkSlidingWindow: limiter }));
vi.mock('../../application/runtime/workerEgressDeclarations', () => ({ declaredExternalApiOrigins: declared }));
vi.mock('../middleware/authMiddleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/authMiddleware')>()),
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));

import { createWorkerPolicyRoutes } from './workerPolicyRoutes';
import { errorHandler } from '../middleware/errorHandler';
import { previewOriginKey } from '../../application/runtime/previewOriginKey';
import { DEFAULT_WORKER_EGRESS_POLICY, resolveWorkerEgressPolicy } from '../../application/runtime/workerEgressPolicy';
import type { HonoEnv } from '../../env';

const SECRET = 'test-secret';
const APP = 'app:42:0123456789abcdef';
const valid = { projectId: 42, applicationId: APP };
const host = (key: string) => `${key}.preview.builderforce.ai`;

function harness(role = 'developer') {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('tenantId' as never, 7 as never);
    c.set('segmentId' as never, 'seg' as never);
    c.set('role' as never, role as never);
    await next();
  });
  app.route('/', createWorkerPolicyRoutes({} as never));
  app.onError(errorHandler as never);
  return (body: unknown) => app.request('/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { JWT_SECRET: SECRET } as never, { waitUntil: () => {}, passThroughOnException: () => {} } as never);
}

describe('POST /runtime/worker-policy', () => {
  beforeEach(() => {
    inScope.mockReset().mockResolvedValue(true);
    declared.mockReset().mockResolvedValue([]);
    limiter.mockReset().mockResolvedValue({ allowed: true, current: 1, limit: 60, resetAt: '2026-11-18T10:01:00.000Z', retryAfterSeconds: 60 });
  });

  it('mints a policy bound to the server-derived app origin, checking the project against the session scope', async () => {
    const res = await harness()(valid);
    expect(res.status).toBe(200);
    const body = await res.json() as { policy: string; expiresAt: string; originKey: string };
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'originKey', 'policy']);
    expect(body.originKey).toBe(await previewOriginKey('42', APP));
    expect(body.policy).toMatch(/^[A-Za-z0-9._~-]{1,512}$/);
    const [, , ctx, projectId] = inScope.mock.calls[0]!;
    expect(ctx).toEqual({ tenantId: 7, segmentId: 'seg' });
    expect(projectId).toBe(42);
    expect(limiter.mock.calls[0]![1]).toBe('7:worker-policy');
    // Nothing is declared: the policy adds no origins beyond the default allowlist.
    expect(await resolveWorkerEgressPolicy(SECRET, body.policy, host(body.originKey))).toEqual({ id: body.policy, connectSources: [] });
    expect(await resolveWorkerEgressPolicy(SECRET, body.policy, host(await previewOriginKey('43', 'app:43:0123456789abcdef'))))
      .toBe(DEFAULT_WORKER_EGRESS_POLICY);
  });

  it('refuses client-sent origins or origin key with 400 and mints nothing', async () => {
    for (const patch of [
      { origins: ['https://evil.example.com'] }, { connectSources: ['https://evil.example.com'] }, { originKey: 'f'.repeat(32) },
    ]) {
      expect((await harness()({ ...valid, ...patch })).status).toBe(400);
    }
    expect(inScope).not.toHaveBeenCalled();
  });

  it('refuses an application id of another project with 400', async () => {
    expect((await harness()({ projectId: 42, applicationId: 'app:43:0123456789abcdef' })).status).toBe(400);
    expect((await harness()({ projectId: 4, applicationId: APP })).status).toBe(400);
    expect(inScope).not.toHaveBeenCalled();
  });

  it.each(['viewer', 'contributor'])('refuses a %s with 403', async (role) => {
    expect((await harness(role)(valid)).status).toBe(403);
    expect(inScope).not.toHaveBeenCalled();
  });

  it('answers 404 for a project outside the caller\'s tenant or segment', async () => {
    inScope.mockResolvedValue(false);
    const res = await harness()(valid);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('policy');
  });

  it('answers a generic 422 when the project declares an origin that cannot be allowed', async () => {
    declared.mockResolvedValue(['https://api.builderforce.ai']);
    const res = await harness()(valid);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain('api.builderforce.ai');
    expect(text).not.toContain('policy"');
  });

  it('answers 429 with Retry-After over the worker-policy bucket, before reading the project', async () => {
    limiter.mockResolvedValue({ allowed: false, current: 61, limit: 60, resetAt: '2026-11-18T10:01:00.000Z', retryAfterSeconds: 30 });
    const res = await harness()(valid);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(inScope).not.toHaveBeenCalled();
  });

  it.each([
    ['an uppercase application id', { applicationId: 'app:42:0123456789ABCDEF' }],
    ['a bare application name', { applicationId: 'web' }],
    ['a non-integer projectId', { projectId: '42' }],
    ['a client-chosen tenant', { tenantId: 99 }],
  ])('refuses %s with 400', async (_label, patch) => {
    expect((await harness()({ ...valid, ...patch })).status).toBe(400);
    expect(inScope).not.toHaveBeenCalled();
  });
});
