/**
 * The team feed reads the converged store (0442) through the SAME version token
 * `remember` bumps. What has to hold: a pushed key round-trips through
 * parse/build, the projection is the published TeamMemoryEntry shape, repeat
 * reads are cache hits, and a write to the store makes the next read reload.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { listTeamMemoryEntries, parseTeamMemoryKey, teamMemoryKey } from './teamMemoryFeed';

vi.mock('../llm/projectFacts', () => ({
  projectFactsVersion: async () => '0',
  QA_CACHE_SOURCE: 'qa', deleteProjectFact: vi.fn(), recallProjectFacts: vi.fn(), upsertProjectFact: vi.fn(),
}));

const env = {} as Env;

function makeDb(rows: Array<{ id: string; key: string; content: string; tags: string; createdAt: Date }>) {
  const calls = { loads: 0 };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => { calls.loads += 1; return rows; } }) }) }) }),
  } as unknown as Db;
  return { db, calls };
}

describe('team memory keys', () => {
  it('round-trip, keeping a runId that itself contains colons', () => {
    const key = teamMemoryKey('42', 'run:2026:09');
    expect(key).toBe('team:42:run:2026:09');
    expect(parseTeamMemoryKey(key)).toEqual({ agentHostId: '42', runId: 'run:2026:09' });
  });
});

describe('listTeamMemoryEntries', () => {
  const at = new Date('2026-09-06T08:00:00.000Z');
  const rows = [{ id: 'm1', key: 'team:7:r1', content: 'Refactored auth', tags: '["auth"]', createdAt: at }];

  it('projects rows onto TeamMemoryEntry and caches repeat reads', async () => {
    const { db, calls } = makeDb(rows);
    const entries = await listTeamMemoryEntries(env, db, 1, 20);
    expect(entries).toEqual([{ id: 'm1', agentHostId: '7', runId: 'r1', summary: 'Refactored auth', tags: ['auth'], timestamp: at.toISOString(), createdAt: at.toISOString() }]);
    await listTeamMemoryEntries(env, db, 1, 20);
    expect(calls.loads).toBe(1);
  });

  it("reloads once the tenant's memory version is bumped (what `remember` does)", async () => {
    const { db, calls } = makeDb(rows);
    await listTeamMemoryEntries(env, db, 1, 20);
    await bumpCacheVersion(env, 'mem:ver:1');
    await listTeamMemoryEntries(env, db, 1, 20);
    expect(calls.loads).toBe(2);
  });
});
