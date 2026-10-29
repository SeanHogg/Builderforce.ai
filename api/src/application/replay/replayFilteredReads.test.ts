/**
 * KPIs and issues honour the filter (PRD 33 D15/D18): unfiltered they are the exact
 * rollups; a filter switches them to the KEPT recordings matching it (THE compiler),
 * weighted by sample_weight and marked `estimated`. The filter is part of the cache
 * key, so a filtered answer is never served for another filter. Live presence is
 * held in the isolate only — never a KV entry.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { ReplayFilter } from '@builderforce/interaction-contract';
import { ReplayReadService } from './ReplayReadService';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const NOW = new Date('2026-10-12T10:00:00.000Z');
const PHONES: ReplayFilter = { all: [{ field: 'device', op: 'eq', value: 'phone' }] };
const DESKTOPS: ReplayFilter = { all: [{ field: 'device', op: 'eq', value: 'desktop' }] };
const dialect = new PgDialect();

/** Each `select()` answers the next queued select result; each `execute()` the next queued execute result. */
function fakeStore(selects: unknown[][], executes: unknown[][] = []) {
  const wheres: SQL[] = [];
  const executed: SQL[] = [];
  let s = 0;
  let e = 0;
  const db = {
    select: () => {
      const rows = selects[s++] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'groupBy', 'orderBy', 'limit', 'offset']) chain[m] = () => chain;
      chain.where = (w: SQL) => { wheres.push(w); return chain; };
      chain.then = (resolve: (v: unknown) => unknown, reject: (err: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    },
    execute: async (q: SQL) => { executed.push(q); return { rows: executes[e++] ?? [] }; },
  };
  return { db: db as never, wheres, executed, selectCount: () => s };
}

const service = (db: never, env: unknown = {}) => new ReplayReadService(env as never, db, () => NOW);
const params = (w: SQL) => dialect.sqlToQuery(w).params;

describe('kpis', () => {
  it('is exact (rollups, not estimated) without a filter', async () => {
    const { db, wheres } = fakeStore([[{ day: '2026-10-12', sessions: '10', pageviews: '20', newVisitors: '4', conversions: '1', frustrated: '2', errors: '0' }], []]);
    const kpis = await service(db).kpis(SCOPE, { days: 7 });
    expect(kpis.sessions).toBe(10);
    expect(kpis.newVisitors).toBe(4);
    expect(kpis.estimated).toBeUndefined();
    expect(dialect.sqlToQuery(wheres[0]!).sql).toContain('"replay_route_daily"');
  });

  it('estimates from the kept recordings matching the filter, weighted, inside the scope', async () => {
    const { db, wheres } = fakeStore([[
      { day: '2026-10-11', sessions: '30.4', pageviews: '90', conversions: '3', frustrated: '6', errors: '15' },
      { day: '2026-10-12', sessions: '10', pageviews: '30', conversions: '1', frustrated: '2', errors: '5' },
    ]]);
    const kpis = await service(db).kpis(SCOPE, { days: 7, filter: PHONES, release: 'r9' });
    expect(kpis).toMatchObject({
      estimated: true, sessions: 40, pageviews: 120, conversions: 4, frustratedSessions: 8, newVisitors: 0, lcpP75: null,
    });
    expect(kpis.errorsPer1k).toBeCloseTo((20 / 40.4) * 1000, 5);
    expect(kpis.trend).toHaveLength(7);
    expect(kpis.trend[6]).toEqual({ day: '2026-10-12', sessions: 10, frustrated: 2, conversions: 1 });
    const { sql, params: p } = dialect.sqlToQuery(wheres[0]!);
    expect(sql).toContain('"replay_recordings"');
    expect(p).toEqual(expect.arrayContaining([7, SITE, 'phone', 'r9']));
  });

  it('keys the cache by the filter: the same filter is reused, another one is read', async () => {
    const day = [{ day: '2026-10-12', sessions: '1', pageviews: '1', conversions: '0', frustrated: '0', errors: '0' }];
    const { db, selectCount } = fakeStore([day, day, day]);
    const reads = service(db);
    await reads.kpis(SCOPE, { days: 7, filter: PHONES });
    await reads.kpis(SCOPE, { days: 7, filter: PHONES });
    expect(selectCount()).toBe(1);
    await reads.kpis(SCOPE, { days: 7, filter: DESKTOPS });
    expect(selectCount()).toBe(2);
  });
});

describe('issues', () => {
  it('ranks the issues the filtered recordings hit, by weighted sessions, with a share of the filtered route', async () => {
    const issueRow = (id: string, fingerprint: string, route: string) => ({
      id, fingerprint, kind: 'rage', route, subject: 'button', title: `Rage on ${route}`, status: 'new',
      firstRelease: null, lastRelease: null, firstSeenAt: NOW, lastSeenAt: NOW, prescriptionId: null,
    });
    const { db, wheres, executed } = fakeStore(
      [[issueRow('i-a', 'fp-a', '/cart'), issueRow('i-b', 'fp-b', '/pay')]],
      [
        [
          { fp: 'fp-a', day: '2026-10-11', sessions: '2' },
          { fp: 'fp-b', day: '2026-10-12', sessions: '6' },
          { fp: 'fp-a', day: '2026-10-12', sessions: '1' },
        ],
        [{ route: '/pay', sessions: '12' }],
      ],
    );
    const page = await service(db).issues(SCOPE, { days: 7, filter: PHONES, limit: 1 });
    expect(page.estimated).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'i-b', sessions: 6, share: 0.5 });
    expect(page.items[0]!.sparkline).toEqual([0, 0, 0, 0, 0, 0, 6]);
    expect(page.nextCursor).toBe('1');
    // The fingerprint fold and the route totals both read the scoped, filtered kept recordings.
    for (const q of executed) expect(params(q)).toEqual(expect.arrayContaining([7, SITE, 'phone']));
    // The issue rows are scoped too.
    expect(params(wheres[0]!)).toEqual(expect.arrayContaining([7, SITE, 'fp-a', 'fp-b']));
  });

  it('answers an empty, estimated page when no kept recording matches', async () => {
    const { db, selectCount } = fakeStore([], [[]]);
    const page = await service(db).issues(SCOPE, { days: 7, filter: PHONES });
    expect(page).toEqual({ items: [], nextCursor: null, estimated: true });
    expect(selectCount()).toBe(0);
  });
});

describe('live', () => {
  it('is held in the isolate for a few seconds and never touches KV', async () => {
    const kv = { get: vi.fn(async () => null), put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
    // One cache fill runs several selects (visitor list, exact total, by-route aggregate).
    const { db, selectCount } = fakeStore([[], [{ n: '0' }], []]);
    const reads = service(db, { AUTH_CACHE_KV: kv });
    await reads.live(SCOPE);
    const afterFirst = selectCount();
    expect(afterFirst).toBeGreaterThan(0);
    // The second call inside the TTL is served from the isolate: no new selects.
    await reads.live(SCOPE);
    expect(selectCount()).toBe(afterFirst);
    const touched = [...kv.get.mock.calls, ...kv.put.mock.calls].map((call) => String((call as unknown[])[0]));
    expect(touched.some((key) => key.includes(':live'))).toBe(false);
  });
});
