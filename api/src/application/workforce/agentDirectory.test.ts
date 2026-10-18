import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agent directory is the ONE reader behind every workforce agent list. The
 * regression it closes: `/api/workforce/agents/purchased` and
 * `/api/runtime/hired-agents` ran the same query under two cache keys, and a
 * personality edit busted only one of them.
 */

const getOrSetCached = vi.fn(async (_env: unknown, _key: string, _load: () => unknown) => [] as unknown[]);
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached,
  invalidateCached: vi.fn(async () => {}),
}));

const { listWorkforceAgents, hiredAgentsCacheKey, PUBLIC_LIST_CACHE_KEY, mapAgentRow, mapPublicAgentRow } = await import('./agentDirectory');

const env = {} as never;
const db = {} as never;

beforeEach(() => getOrSetCached.mockClear());

describe('listWorkforceAgents cache keys', () => {
  it('serves the hired scope from the ONE hired-agents key', async () => {
    await listWorkforceAgents(env, db, { scope: 'hired', tenantId: 42 });
    expect(getOrSetCached.mock.calls[0]?.[1]).toBe('wf:purchased:42');
    expect(hiredAgentsCacheKey(42)).toBe('wf:purchased:42');
  });

  it('serves the public scope from the shared public listing key', async () => {
    await listWorkforceAgents(env, db, { scope: 'public' });
    expect(getOrSetCached.mock.calls[0]?.[1]).toBe(PUBLIC_LIST_CACHE_KEY);
  });
});

describe('projections', () => {
  it('owner rows parse skills and psychometric JSON', () => {
    expect(mapAgentRow({ skills: '["a"]', psychometric: '{"o":1}' })).toEqual({ skills: ['a'], psychometric: { o: 1 } });
  });

  it('public rows are an allowlist', () => {
    const view = mapPublicAgentRow({ id: 'x', tenant_id: 1, role_keys: '[]', psychometric: '{}', eval_score: '0.5' });
    expect(view).not.toHaveProperty('tenant_id');
    expect(view).not.toHaveProperty('role_keys');
    expect(view.evalScore).toBe(0.5);
  });
});

describe('no second hired-agents read', () => {
  const read = (relative: string) => readFileSync(join(__dirname, '../..', relative), 'utf8');

  it.each([
    'presentation/routes/workforceRoutes.ts',
    'presentation/routes/runtimeRoutes.ts',
  ])('%s lists hired agents through the directory', (relative) => {
    const source = read(relative);
    expect(source).toContain("scope: 'hired'");
    expect(source).not.toContain('rt:hired-agents');
    expect(source).not.toMatch(/innerJoin\(agentPurchases,\s*eq\(agentPurchases\.agentId,\s*ideAgents\.id\)\)/);
  });

  it('the developer API lists the public directory, not the legacy registry', () => {
    const source = read('presentation/routes/publicApiRoutes.ts');
    expect(source).toContain("scope: 'public'");
    expect(source).not.toMatch(/schema\.agents\b/);
  });
});
