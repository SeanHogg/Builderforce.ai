import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  fetchSince: vi.fn(),
  ingest: vi.fn(),
  kv: new Map<string, unknown>(),
}));

vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../repos/resolveRepoCredential', () => ({
  resolveRepoCredential: async () => ({ token: 'tok' }),
  isResolveError: () => false,
}));
vi.mock('../repos/sources/RepoSource', () => ({ makeRepoFetch: () => fetch }));
vi.mock('./activitySourceFactory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./activitySourceFactory')>()),
  createActivitySource: () => ({ fetchSince: mocks.fetchSince }),
}));
vi.mock('./activityIngest', () => ({ ingestActivityEvents: mocks.ingest }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: async (_env: unknown, key: string) => mocks.kv.get(key) ?? null,
  setCached: async (_env: unknown, key: string, value: unknown) => { mocks.kv.set(key, value); },
}));

const { runRepoActivitySweep, REPO_ACTIVITY_STAMPS_KEY } = await import('./runRepoActivitySweep');

const ENV = {} as Env;
const repo = (id: string, lastActivitySyncedAt: Date | null = null) => ({
  id, tenantId: 1, provider: 'github', owner: 'acme', repo: id, host: null,
  credentialId: 'cred-1', lastActivitySyncedAt,
});

/** Fake Db: the one candidate select resolves to `rows`; every UPDATE is recorded. */
function fakeDb(rows: unknown[]) {
  const updates: unknown[] = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => rows }) }),
    update: () => ({ set: (values: unknown) => ({ where: async () => { updates.push(values); } }) }),
  };
  return { db: db as never, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kv.clear();
  mocks.ingest.mockResolvedValue({ inserted: 0 });
});

describe('runRepoActivitySweep — idle-silent watermark', () => {
  it('a quiet tick (no activity seen) issues NO database write and stamps KV instead', async () => {
    mocks.fetchSince.mockResolvedValue([]);
    const { db, updates } = fakeDb([repo('a'), repo('b', new Date(Date.now() - 60 * 60_000))]);
    const r = await runRepoActivitySweep(ENV, db);
    expect(r.synced).toBe(2);
    expect(updates).toHaveLength(0);
    expect(Object.keys(mocks.kv.get(REPO_ACTIVITY_STAMPS_KEY) as object).sort()).toEqual(['a', 'b']);
  });

  it('advances only the repos that saw activity, in ONE update', async () => {
    mocks.fetchSince.mockImplementation(async (_since: Date, fullName: string) => (fullName === 'acme/b' ? [{ id: 1 }] : []));
    mocks.ingest.mockResolvedValue({ inserted: 1 });
    const { db, updates } = fakeDb([repo('a'), repo('b')]);
    const r = await runRepoActivitySweep(ENV, db);
    expect(r.inserted).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it('does not re-poll a repo the KV ledger checked inside the interval', async () => {
    mocks.kv.set(REPO_ACTIVITY_STAMPS_KEY, { a: Date.now() - 60_000 });
    mocks.fetchSince.mockResolvedValue([]);
    const { db, updates } = fakeDb([repo('a')]);
    const r = await runRepoActivitySweep(ENV, db);
    expect(r.due).toBe(0);
    expect(mocks.fetchSince).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});
