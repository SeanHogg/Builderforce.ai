import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  store: vi.fn(),
  kv: new Map<string, unknown>(),
}));

vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('./repoDelivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repoDelivery')>()),
  probeRepoDelivery: mocks.probe,
  storeRepoDelivery: mocks.store,
}));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: async (_env: unknown, key: string) => mocks.kv.get(key) ?? null,
  setCached: async (_env: unknown, key: string, value: unknown) => { mocks.kv.set(key, value); },
}));

const { runRepoDeliverySweep, repoDeliveryVerdictChanged, REPO_DELIVERY_PROBE_INTERVAL_MS } = await import('./repoDeliverySweep');
const { REPO_DELIVERY_STAMPS_KEY } = await import('./repoDelivery');

const ENV = {} as Env;
const verdict = {
  health: 'ok' as const, reason: null, openPullRequests: 3,
  buildStatus: 'success' as const, buildUrl: 'https://ci/1', buildBranch: 'main',
  buildAt: '2026-10-17T10:00:00.000Z',
};
const stored = { ...verdict, buildAt: new Date('2026-10-17T10:00:00.000Z') };
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, tenantId: 1, owner: 'acme', repo: id,
  ...stored, probedAt: new Date(Date.now() - 2 * REPO_DELIVERY_PROBE_INTERVAL_MS), ...over,
});

/** Fake Db: the candidate select resolves to `rows`; any UPDATE/INSERT is recorded. */
function fakeDb(rows: unknown[]) {
  const writes: string[] = [];
  const db = {
    select: () => ({ from: () => ({ leftJoin: () => ({ where: async () => rows }) }) }),
    update: () => { writes.push('update'); return { set: () => ({ where: async () => undefined }) }; },
    insert: () => { writes.push('insert'); return { values: () => ({ onConflictDoUpdate: async () => undefined }) }; },
  };
  return { db: db as never, writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kv.clear();
});

describe('repo-delivery sweep — idle-silent', () => {
  it('an unchanged probe writes NOTHING to Postgres; the probe is stamped in KV', async () => {
    mocks.probe.mockResolvedValue(verdict);
    const { db, writes } = fakeDb([row('a')]);
    const r = await runRepoDeliverySweep(ENV, db);
    expect(r.probed).toBe(1);
    expect(mocks.store).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(Object.keys(mocks.kv.get(REPO_DELIVERY_STAMPS_KEY) as object)).toEqual(['a']);
  });

  it('a changed verdict is ONE store (which carries probed_at)', async () => {
    mocks.probe.mockResolvedValue({ ...verdict, openPullRequests: 9 });
    const { db } = fakeDb([row('a')]);
    await runRepoDeliverySweep(ENV, db);
    expect(mocks.store).toHaveBeenCalledTimes(1);
  });

  it('skips a repo the KV ledger probed inside the interval, even with a stale column', async () => {
    mocks.kv.set(REPO_DELIVERY_STAMPS_KEY, { a: Date.now() - 60_000 });
    const { db } = fakeDb([row('a')]);
    const r = await runRepoDeliverySweep(ENV, db);
    expect(r.due).toBe(0);
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it('falls back to the column when KV has no stamp', async () => {
    const { db } = fakeDb([row('a', { probedAt: new Date() })]);
    const r = await runRepoDeliverySweep(ENV, db);
    expect(r.due).toBe(0);
  });
});

describe('repo-delivery verdict comparison', () => {
  it('probes far less often than the 5-minute tick', () => {
    expect(REPO_DELIVERY_PROBE_INTERVAL_MS).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it('treats an identical probe as unchanged (Date vs ISO buildAt compare by instant)', () => {
    expect(repoDeliveryVerdictChanged(stored, verdict)).toBe(false);
  });

  it('flags any changed field, and a missing row, as a change', () => {
    expect(repoDeliveryVerdictChanged(null, verdict)).toBe(true);
    expect(repoDeliveryVerdictChanged({ ...stored, health: null }, verdict)).toBe(true);
    expect(repoDeliveryVerdictChanged(stored, { ...verdict, openPullRequests: 4 })).toBe(true);
    expect(repoDeliveryVerdictChanged(stored, { ...verdict, buildStatus: 'failure' })).toBe(true);
    expect(repoDeliveryVerdictChanged(stored, { ...verdict, buildAt: '2026-10-17T11:00:00.000Z' })).toBe(true);
    expect(repoDeliveryVerdictChanged(stored, { ...verdict, health: 'error', reason: 'unauthorized' })).toBe(true);
  });
});
