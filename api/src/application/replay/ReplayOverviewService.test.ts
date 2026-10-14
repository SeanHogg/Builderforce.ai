/**
 * The Overview: unfiltered it is exact (rollups, `estimated: false`); a filter
 * switches every block to the kept recordings weighted by sample_weight
 * (`estimated: true`, null where a kept row cannot know). Every statement carries
 * the full scope; one grouped statement per block.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { ReplayOverviewService } from './ReplayOverviewService';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const NOW = new Date('2026-10-12T10:00:00.000Z');
const dialect = new PgDialect();

/** A fake store: each `select()` answers the next queued result; `execute` answers `rows`. */
function fakeStore(results: unknown[][], executeRows: unknown[] = []) {
  const wheres: SQL[] = [];
  const executed: SQL[] = [];
  let i = 0;
  const db = {
    select: () => {
      const rows = results[i++] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'groupBy', 'orderBy', 'limit']) chain[m] = () => chain;
      chain.where = (w: SQL) => { wheres.push(w); return chain; };
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    },
    execute: async (q: SQL) => { executed.push(q); return { rows: executeRows }; },
  };
  return { db: db as never, wheres, executed, selects: () => i };
}

const service = (db: never) => new ReplayOverviewService({} as never, db, () => NOW);

describe('overview — unfiltered (exact rollups)', () => {
  it('folds the four rollup blocks into the dashboard', async () => {
    const { db, wheres, selects, executed } = fakeStore([
      [
        { day: '2026-10-11', sessions: '80', newVisitors: '30', pageviews: '200', frustrated: '8', activeMs: '800000', scrollDepth: '1000' },
        { day: '2026-10-12', sessions: '20', newVisitors: '10', pageviews: '50', frustrated: '2', activeMs: '200000', scrollDepth: '250' },
      ],
      [{ value: '/pricing', sessions: '90' }, { value: '/', sessions: '120' }],
      [
        { dim: 'country', value: 'US', sessions: '60' }, { dim: 'country', value: 'DE', sessions: '40' },
        { dim: 'entry', value: '/', sessions: '70' }, { dim: 'device', value: 'phone', sessions: '55' },
      ],
      [{ kind: 'rage', sessions: '5' }, { kind: 'error', sessions: '12' }, { kind: 'quickback', sessions: '500' }],
    ]);
    const out = await service(db).overview(SCOPE, { days: 7 });
    expect(selects()).toBe(4);
    expect(executed).toHaveLength(0);
    expect(out).toMatchObject({
      days: 7, sessions: 100, newVisitors: 40, pagesPerSession: 2.5, avgActiveMs: 10_000, avgScrollDepthPct: 50, estimated: false,
    });
    expect(out.frustration).toEqual({ rage: 0.05, dead: 0, quickback: 1, excessiveScroll: 0, error: 0.12 });
    expect(out.trend).toHaveLength(7);
    expect(out.trend[6]).toEqual({ day: '2026-10-12', sessions: 20, frustratedPct: 10 });
    expect(out.top.pages.map((p) => p.value)).toEqual(['/', '/pricing']);
    expect(out.top.countries).toEqual([{ value: 'US', sessions: 60 }, { value: 'DE', sessions: 40 }]);
    expect(out.top.entryPages).toEqual([{ value: '/', sessions: 70 }]);
    expect(out.top.browsers).toEqual([]);
    for (const w of wheres) expect(dialect.sqlToQuery(w).params).toEqual(expect.arrayContaining([7, SITE]));
  });
});

describe('overview — filtered (kept recordings, weighted)', () => {
  it('reads kept recordings weighted by sample_weight and says it is estimated', async () => {
    const { db, wheres, executed } = fakeStore(
      [[{ day: '2026-10-12', sessions: '40', pages: '120', activeMs: '400000', frustrated: '10', rage: '4', dead: '2', quickback: '0', excessiveScroll: '1', error: '8' }]],
      [
        { key: 'pages', value: '/checkout', sessions: '30' },
        { key: 'devices', value: 'phone', sessions: '40' },
        { key: 'nope', value: 'x', sessions: '1' },
      ],
    );
    const out = await service(db).overview(SCOPE, { days: 7, filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] } });
    expect(out).toMatchObject({ sessions: 40, newVisitors: null, avgScrollDepthPct: null, pagesPerSession: 3, avgActiveMs: 10_000, estimated: true });
    expect(out.frustration).toEqual({ rage: 0.1, dead: 0.05, quickback: 0, excessiveScroll: 0.025, error: 0.2 });
    expect(out.top.pages).toEqual([{ value: '/checkout', sessions: 30 }]);
    expect(out.top.devices).toEqual([{ value: 'phone', sessions: 40 }]);
    const daily = dialect.sqlToQuery(wheres[0]!);
    expect(daily.params).toEqual(expect.arrayContaining([7, SITE, 'phone']));
    const tops = dialect.sqlToQuery(executed[0]!);
    expect(tops.sql).toContain('unnest("replay_recordings"."routes")');
    expect(tops.sql).toContain('"replay_recordings"."sample_weight"');
    expect(tops.params.filter((p) => p === 7)).toHaveLength(8);
  });
});
