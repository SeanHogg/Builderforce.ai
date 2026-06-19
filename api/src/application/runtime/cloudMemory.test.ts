import { describe, expect, it, vi } from 'vitest';
import { buildCloudMemoryCapability } from './cloudMemory';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

// No KV bound → readVersion() returns 0 and getOrSetCached falls through to the loader,
// so recall logic is exercised directly (the repo's standard "no KV → loader" contract).
const env = {} as Env;

/** Mock the drizzle SELECT chain used by recall(), capturing the LIMIT passed. */
function recallDb(rows: Array<{ key: string; content: string }>, cap: { limit?: number } = {}) {
  const limit = vi.fn(async (n: number) => {
    cap.limit = n;
    return rows;
  });
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit }) }) }) }));
  return { select } as unknown as Db;
}

/** Mock the drizzle INSERT…onConflictDoUpdate chain used by remember(). */
function rememberDb(cap: { values?: unknown; conflict?: unknown } = {}) {
  const onConflictDoUpdate = vi.fn(async (c: unknown) => {
    cap.conflict = c;
  });
  const values = vi.fn((v: unknown) => {
    cap.values = v;
    return { onConflictDoUpdate };
  });
  return { insert: vi.fn(() => ({ values })) } as unknown as Db;
}

describe('buildCloudMemoryCapability', () => {
  it('remember upserts and returns {ok, key}', async () => {
    const cap: { values?: Record<string, unknown>; conflict?: { target?: unknown[] } } = {};
    const mem = buildCloudMemoryCapability({ db: rememberDb(cap), env, tenantId: 7 });
    const r = await mem.remember('deploy', 'pnpm build && wrangler deploy', { tags: ['ops'], importance: 0.9 });

    expect(r).toEqual({ ok: true, key: 'deploy' });
    expect(cap.values).toMatchObject({ tenantId: 7, key: 'deploy', content: 'pnpm build && wrangler deploy', importance: 0.9 });
    expect(cap.values?.tags).toBe('["ops"]'); // tags serialized to JSON text
    expect(cap.conflict?.target).toHaveLength(2); // ON CONFLICT (tenant_id, key)
  });

  it('remember clamps importance to [0,1] and defaults tags to []', async () => {
    const cap: { values?: Record<string, unknown> } = {};
    const mem = buildCloudMemoryCapability({ db: rememberDb(cap), env, tenantId: 1 });
    await mem.remember('k', 'v', { importance: 5 });
    expect(cap.values?.importance).toBe(1);
    expect(cap.values?.tags).toBe('[]');
  });

  it('recall returns mapped entries', async () => {
    const rows = [{ key: 'auth-flow', content: 'JWT in cookie' }];
    const mem = buildCloudMemoryCapability({ db: recallDb(rows), env, tenantId: 7 });
    const r = await mem.recall('how does auth work', 3);
    expect(r).toEqual({ ok: true, query: 'how does auth work', entries: rows });
  });

  it('recall clamps the limit to [1,20]', async () => {
    const cap: { limit?: number } = {};
    const mem = buildCloudMemoryCapability({ db: recallDb([], cap), env, tenantId: 1 });
    await mem.recall('q', 999);
    expect(cap.limit).toBe(20);
    await mem.recall('q', 0);
    expect(cap.limit).toBe(1);
    await mem.recall('q');
    expect(cap.limit).toBe(5); // default
  });

  it('degrades to {ok:false,error} when the store fails (e.g. table missing pre-migration)', async () => {
    const failing = {
      insert: () => ({ values: () => ({ onConflictDoUpdate: async () => { throw new Error('relation "agent_memory" does not exist'); } }) }),
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => { throw new Error('relation "agent_memory" does not exist'); } }) }) }) }),
    } as unknown as Db;
    const mem = buildCloudMemoryCapability({ db: failing, env, tenantId: 1 });

    expect((await mem.remember('k', 'v')).ok).toBe(false);
    expect((await mem.recall('q')).ok).toBe(false);
  });
});
