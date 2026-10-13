/**
 * The nightly issue rollup: representatives by visit shape (k-medoids over Jaccard
 * of step 2-grams, ≤ 3, replacing the previous set), regressions by interval after
 * the newest release (only from regressable statuses), once per site per day.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({ bumpSiteVersion: vi.fn(async () => {}) }));
vi.mock('./replayCacheKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replayCacheKeys')>()),
  bumpSiteVersion: mocks.bumpSiteVersion,
}));

import { bigrams, isRegressed, jaccardDistance, pickRepresentatives, wilson } from '../../domain/replay/issueClusters';
import { rollupSite, runReplayRollup } from './replayRollup';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const ISSUE = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW = new Date('2026-10-12T03:00:00.000Z');
const dialect = new PgDialect();
const rid = (i: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}`;

describe('pickRepresentatives', () => {
  it('finds one medoid per visit shape, ranked by cluster size', () => {
    const checkout = ['page:/', 'page:/cart', 'page:/checkout'];
    const blog = ['page:/blog', 'page:/blog/a'];
    const candidates = [
      ...Array.from({ length: 6 }, (_, i) => ({ recordingId: rid(i), steps: checkout })),
      ...Array.from({ length: 3 }, (_, i) => ({ recordingId: rid(10 + i), steps: blog })),
      { recordingId: rid(20), steps: ['page:/pricing'] },
    ];
    const reps = pickRepresentatives(candidates);
    expect(reps).toHaveLength(3);
    expect(reps.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(reps[0]).toMatchObject({ share: 0.6, label: '/ → /cart → /checkout' });
    expect(reps[1]).toMatchObject({ share: 0.3, label: '/blog → /blog/a' });
    expect(reps[2]).toMatchObject({ recordingId: rid(20), share: 0.1 });
  });

  it('never shows the same visit shape twice', () => {
    const same = Array.from({ length: 5 }, (_, i) => ({ recordingId: rid(i), steps: ['page:/a', 'page:/b'] }));
    expect(pickRepresentatives(same)).toHaveLength(1);
    expect(pickRepresentatives([])).toEqual([]);
  });

  it('measures Jaccard distance over 2-grams', () => {
    expect(jaccardDistance(bigrams(['a', 'b', 'c']), bigrams(['a', 'b', 'c']))).toBe(0);
    expect(jaccardDistance(bigrams(['a', 'b', 'c']), bigrams(['a', 'b', 'd']))).toBeCloseTo(2 / 3);
  });
});

describe('isRegressed', () => {
  it('needs the after-release interval to clear the before-release interval', () => {
    expect(isRegressed({ hits: 10, sessions: 1_000 }, { hits: 80, sessions: 1_000 })).toBe(true);
    expect(isRegressed({ hits: 10, sessions: 1_000 }, { hits: 14, sessions: 1_000 })).toBe(false);
    expect(isRegressed({ hits: 0, sessions: 10 }, { hits: 10, sessions: 10 })).toBe(false); // too few sessions
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

/** A fake telemetry store answering each select in order; records writes. */
function fakeStore(answers: unknown[][]) {
  const wheres: SQL[] = [];
  const deletes: SQL[] = [];
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  let i = 0;
  const db = {
    select: () => {
      const rows = answers[i++] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'groupBy', 'orderBy']) chain[m] = () => chain;
      chain.where = (w: SQL) => { wheres.push(w); return chain; };
      chain.limit = async () => rows;
      chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
      return chain;
    },
    delete: () => ({ where: async (w: SQL) => { deletes.push(w); } }),
    insert: () => ({ values: async (v: unknown) => { inserts.push(v); } }),
    update: () => ({ set: (v: unknown) => ({ where: () => ({ returning: async () => { updates.push(v); return [{ id: ISSUE }]; } }) }) }),
  };
  return { db: db as never, wheres, deletes, inserts, updates, selects: () => i };
}

describe('rollupSite', () => {
  const issue = { id: ISSUE, fingerprint: 'fp1', route: '/checkout', status: 'ongoing' };
  const release = { releaseKey: 'r9', firstSeenAt: new Date('2026-10-05T00:00:00Z') };
  const candidates = [{ recordingId: rid(1), steps: ['page:/', 'page:/checkout'] }];
  const issueDaily = [{ issueId: ISSUE, day: '2026-09-20', sessions: '10' }, { issueId: ISSUE, day: '2026-10-08', sessions: '90' }];
  const routeDaily = [{ route: '/checkout', day: '2026-09-20', sessions: '1000' }, { route: '/checkout', day: '2026-10-08', sessions: '1000' }];

  it('replaces representatives and flags a regression after the newest release', async () => {
    const store = fakeStore([[issue], candidates, [release], issueDaily, routeDaily]);
    const out = await rollupSite(store.db, SCOPE, NOW);
    expect(out).toEqual({ issues: 1, representatives: 1, regressed: 1 });
    expect(dialect.sqlToQuery(store.deletes[0]!).params).toEqual([ISSUE]);
    expect(store.inserts[0]).toEqual([{ issueId: ISSUE, rank: 1, recordingId: rid(1), share: 1, label: '/ → /checkout' }]);
    expect(store.updates[0]).toMatchObject({ status: 'regressed' });
    // The candidate read is the issue's fingerprint, inside the full scope.
    const candidateWhere = dialect.sqlToQuery(store.wheres[1]!);
    expect(candidateWhere.sql).toContain('"replay_recordings"."issue_fps" @>');
    expect(candidateWhere.params).toEqual(expect.arrayContaining([7, SITE, '{"fp1"}']));
  });

  it('never re-flags a status a person set', async () => {
    const store = fakeStore([[{ ...issue, status: 'ignored' }], candidates]);
    const out = await rollupSite(store.db, SCOPE, NOW);
    expect(out.regressed).toBe(0);
    expect(store.updates).toEqual([]);
  });
});

describe('runReplayRollup', () => {
  beforeEach(() => mocks.bumpSiteVersion.mockClear());

  it('runs each active site once per day (KV gate) and bumps its version when it wrote', async () => {
    const kvStore = new Map<string, string>();
    const kv = { get: async (k: string) => kvStore.get(k) ?? null, put: async (k: string, v: string) => { kvStore.set(k, v); } };
    const issue = { id: ISSUE, fingerprint: 'fp1', route: '/checkout', status: 'ignored' };
    const first = fakeStore([[{ siteId: SITE, tenantId: 7 }], [issue], [{ recordingId: rid(1), steps: ['page:/'] }]]);
    const out = await runReplayRollup({ AUTH_CACHE_KV: kv } as never, first.db, NOW);
    expect(out).toEqual({ sites: 1, issues: 1, representatives: 1, regressed: 0 });
    expect(mocks.bumpSiteVersion).toHaveBeenCalledTimes(1);

    const again = fakeStore([[{ siteId: SITE, tenantId: 7 }]]);
    expect(await runReplayRollup({ AUTH_CACHE_KV: kv } as never, again.db, NOW)).toEqual({ sites: 0, issues: 0, representatives: 0, regressed: 0 });
    expect(again.selects()).toBe(1);
  });
});
