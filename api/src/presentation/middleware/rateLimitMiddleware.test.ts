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

import { isBoardMutation, rateLimitMiddleware } from './rateLimitMiddleware';

/** A stand-in DO namespace that records the bucket key and limit each check carried.
 *  `allowed` may deny one key while allowing another, so the two windows can be
 *  proven independent. */
function fakeLimiter(allowed: boolean | ((key: string) => boolean) = true) {
  const calls: { key: string; limit: number }[] = [];
  const limits: number[] = [];
  const decide = typeof allowed === 'function' ? allowed : () => allowed;
  const ns = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (req: Request) => {
        const body = (await req.json()) as { limit: number };
        const key = String(id);
        calls.push({ key, limit: body.limit });
        limits.push(body.limit);
        const ok = decide(key);
        return Response.json({
          allowed: ok,
          current: ok ? 1 : body.limit,
          limit: body.limit,
          resetAt: new Date(Date.now() + 30_000).toISOString(),
        });
      },
    }),
  };
  return { ns: ns as unknown as DurableObjectNamespace, limits, calls };
}

function app() {
  const a = new Hono();
  a.use('*', rateLimitMiddleware as never);
  a.all('*', (c) => c.text('ok'));
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

  it('never counts or blocks saving a chat turn', async () => {
    const { ns, limits } = fakeLimiter(false);
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockResolvedValue('free');
    const a = new Hono();
    a.use('*', rateLimitMiddleware as never);
    a.post('/api/brain/chats/:id/messages', (c) => c.text('saved'));
    a.get('/api/brain/chats/:id/messages', (c) => c.text('read'));
    const save = await a.request('/api/brain/chats/112/messages', { method: 'POST' }, { TENANT_RATE_LIMITER: ns });
    expect(save.status).toBe(200);
    expect(limits).toEqual([]);
    // Only the save is exempt — reads still take the tenant limit.
    const read = await a.request('/api/brain/chats/112/messages', {}, { TENANT_RATE_LIMITER: ns });
    expect(read.status).toBe(429);
  });

  it('lets anonymous callers through un-throttled', async () => {
    const { ns, limits } = fakeLimiter();
    resolveBearerTenantId.mockResolvedValue(null);
    const res = await app().request('/x', {}, { TENANT_RATE_LIMITER: ns });
    expect(res.status).toBe(200);
    expect(limits).toEqual([]);
  });

  it('lets an anonymous ticket create through un-throttled', async () => {
    const { ns, calls } = fakeLimiter();
    resolveBearerTenantId.mockResolvedValue(null);
    const res = await app().request('/api/tasks', { method: 'POST' }, { TENANT_RATE_LIMITER: ns });
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it('allows a board write through when the plan lookup fails', async () => {
    const { ns, calls } = fakeLimiter();
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockRejectedValue(new Error('snapshot down'));
    const res = await app().request('/api/tasks', { method: 'POST' }, { TENANT_RATE_LIMITER: ns });
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it('counts a ticket fan-out against a separate higher board bucket', async () => {
    const { ns, calls } = fakeLimiter();
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockResolvedValue('free');
    const fanout = [
      ['POST', '/api/tasks'],
      ['POST', '/api/kanban/tasks/9/participants/materialize'],
      ['POST', '/api/tasks/9/run-now'],
      ['POST', '/api/runtime/executions'],
      ['POST', '/api/brain/chats/112/tickets'],
      ['POST', '/api/boards/b1/swimlanes/l1/run-lane'],
    ] as const;
    for (const [method, path] of fanout) {
      const res = await app().request(path, { method }, { TENANT_RATE_LIMITER: ns });
      expect(res.status).toBe(200);
    }
    expect(calls).toEqual(fanout.map(() => ({ key: '41:board', limit: 1200 })));

    const human = await app().request('/api/projects', {}, { TENANT_RATE_LIMITER: ns });
    expect(human.status).toBe(200);
    expect(calls.at(-1)).toEqual({ key: '41', limit: 300 });
  });

  it('scales the board allowance with the plan and leaves ordinary traffic at plan rpm', async () => {
    const { ns, calls } = fakeLimiter();
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockResolvedValue('pro');
    const board = await app().request('/api/tasks', { method: 'POST' }, { TENANT_RATE_LIMITER: ns });
    const ordinary = await app().request('/x', {}, { TENANT_RATE_LIMITER: ns });
    expect(board.status).toBe(200);
    expect(ordinary.status).toBe(200);
    expect(calls).toEqual([
      { key: '41:board', limit: 4800 },
      { key: '41', limit: 1200 },
    ]);
  });

  it('does not 429 a human when the board bucket is full', async () => {
    const { ns, calls } = fakeLimiter((key) => !key.endsWith(':board'));
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockResolvedValue('free');
    const burst = await app().request('/api/tasks', { method: 'POST' }, { TENANT_RATE_LIMITER: ns });
    expect(burst.status).toBe(429);
    expect(burst.headers.get('X-RateLimit-Limit')).toBe('1200');
    const human = await app().request('/api/brain/chats/112', {}, { TENANT_RATE_LIMITER: ns });
    expect(human.status).toBe(200);
    expect(human.headers.get('X-RateLimit-Limit')).toBe('300');
    expect(calls.map((c) => c.key)).toEqual(['41:board', '41']);
  });

  it('still throttles ordinary traffic, including board reads and neighbouring writes', async () => {
    const { ns } = fakeLimiter((key) => key.endsWith(':board'));
    resolveBearerTenantId.mockResolvedValue(41);
    resolveTenantEffectivePlan.mockResolvedValue('free');
    const env = { TENANT_RATE_LIMITER: ns };
    const ordinary = [
      ['GET', '/x'],
      ['GET', '/api/tasks'],
      ['POST', '/api/llm/chat/completions'],
      ['POST', '/api/runtime/executions/9/telemetry'],
      ['POST', '/api/runtime/executions/cancel-all'],
      ['DELETE', '/api/brain/chats/112/tickets'],
      ['POST', '/api/brain/chats/112/summarize'],
      ['POST', '/api/engagement-board/gigs'],
      ['POST', '/api/tasksfoo'],
    ] as const;
    for (const [method, path] of ordinary) {
      const res = await app().request(path, { method }, env);
      expect(res.status, `${method} ${path}`).toBe(429);
      expect(res.headers.get('X-RateLimit-Limit'), `${method} ${path}`).toBe('300');
    }
    // The board window is a higher cap, not an exemption: it still answers when
    // the tenant window is the one that is full.
    const create = await app().request('/api/tasks', { method: 'POST' }, env);
    expect(create.status).toBe(200);
    expect(create.headers.get('X-RateLimit-Limit')).toBe('1200');
  });
});

describe('isBoardMutation — blast radius', () => {
  it('matches fan-out writes and nothing neighbouring', () => {
    expect(isBoardMutation('POST', '/api/tasks')).toBe(true);
    expect(isBoardMutation('post', '/api/tasks/')).toBe(true);
    expect(isBoardMutation('PATCH', '/api/tasks/9')).toBe(true);
    expect(isBoardMutation('POST', '/api/tasks/9/run-now')).toBe(true);
    expect(isBoardMutation('POST', '/api/kanban/tasks/9/participants/materialize')).toBe(true);
    expect(isBoardMutation('DELETE', '/api/kanban/roles/dev')).toBe(true);
    expect(isBoardMutation('POST', '/api/boards/b1/swimlanes/l1/run-lane')).toBe(true);
    expect(isBoardMutation('POST', '/api/runtime/executions')).toBe(true);
    expect(isBoardMutation('POST', '/api/runtime/executions/')).toBe(true);
    expect(isBoardMutation('POST', '/api/brain/chats/112/tickets')).toBe(true);

    expect(isBoardMutation('GET', '/api/tasks')).toBe(false);
    expect(isBoardMutation('HEAD', '/api/kanban/tasks/9')).toBe(false);
    expect(isBoardMutation('POST', '/api/tasksfoo')).toBe(false);
    expect(isBoardMutation('POST', '/api/engagement-board/gigs')).toBe(false);
    expect(isBoardMutation('POST', '/api/runtime/executions/9/telemetry')).toBe(false);
    expect(isBoardMutation('POST', '/api/runtime/executions/cancel-all')).toBe(false);
    expect(isBoardMutation('POST', '/api/runtime/sessions')).toBe(false);
    expect(isBoardMutation('DELETE', '/api/brain/chats/112/tickets')).toBe(false);
    expect(isBoardMutation('POST', '/api/brain/chats/112/messages')).toBe(false);
    expect(isBoardMutation('POST', '/api/brain/chats/112/summarize')).toBe(false);
    expect(isBoardMutation('POST', '/api/llm/chat/completions')).toBe(false);
    expect(isBoardMutation('GET', '/x')).toBe(false);
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
