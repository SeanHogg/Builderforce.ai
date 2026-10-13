/**
 * The heatmap reads: the grid fold, the element table (ranked by THE heat rule,
 * `rankHeatZones`, with the compare-release delta), scroll reach, the snapshot's
 * first stored seq and the insight rules end to end. The db is a fake whose answers
 * depend on the select shape and the rendered WHERE params (real Postgres dialect).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({ listChunkSeqs: vi.fn(async () => [] as number[]) }));
vi.mock('./replayChunkStore', () => ({ listChunkSeqs: mocks.listChunkSeqs }));
vi.mock('../../domain/qa/heatZones', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../domain/qa/heatZones')>();
  return { ...real, rankHeatZones: vi.fn(real.rankHeatZones) };
});

import { heatScore, rankHeatZones } from '../../domain/qa/heatZones';
import { ReplayHeatmapService } from './ReplayHeatmapService';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const NOW = new Date('2026-10-12T10:00:00.000Z');
const dialect = new PgDialect();
const BUY = 'getByRole("button", { name: "Buy" })';
const OLD = 'getByText("Old banner")';

type Shape = Record<string, unknown>;
type Responder = (shape: Shape, params: unknown[]) => unknown[];

function fakeDb(respond: Responder) {
  const calls: Array<{ shape: Shape; params: unknown[] }> = [];
  const db = {
    select: (shape: Shape) => {
      let params: unknown[] = [];
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'innerJoin', 'groupBy', 'orderBy', 'limit']) chain[method] = () => chain;
      chain.where = (cond: SQL) => {
        params = dialect.sqlToQuery(cond).params;
        return chain;
      };
      chain.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
        calls.push({ shape, params });
        return Promise.resolve().then(() => respond(shape, params)).then(resolve, reject);
      };
      return chain;
    },
  };
  return { db: db as never, calls };
}

const service = (db: never) => new ReplayHeatmapService({} as never, db, () => NOW);

/** Element rows: release r2 is current, r1 the compare release. */
function elementRows(params: unknown[]): unknown[] {
  if (params.includes('r1')) {
    return [
      { selector: BUY, label: 'Buy', kind: 'click', gy: 10, n: '20', lastDay: '2026-10-01' },
      { selector: BUY, label: 'Buy', kind: 'rage', gy: 10, n: '3', lastDay: '2026-10-01' },
    ];
  }
  return [
    { selector: OLD, label: 'Old banner', kind: 'click', gy: 40, n: '60', lastDay: '2026-08-01' },
    { selector: BUY, label: 'Buy', kind: 'click', gy: 10, n: '30', lastDay: '2026-10-11' },
    { selector: BUY, label: 'Buy', kind: 'rage', gy: 12, n: '10', lastDay: '2026-10-11' },
  ];
}

beforeEach(() => {
  mocks.listChunkSeqs.mockReset().mockResolvedValue([]);
  vi.mocked(rankHeatZones).mockClear();
});

describe('grid', () => {
  it('folds summed cells, drops empty ones and totals them, inside the scope', async () => {
    const { db, calls } = fakeDb(() => [{ gx: 1, gy: 2, n: '3' }, { gx: 4, gy: 5, n: '0' }, { gx: 9, gy: 9, n: '4' }]);
    const grid = await service(db).grid(SCOPE, { route: '/pricing', release: 'r2', device: 'phone', kind: 'rage', days: 7 });
    expect(grid).toEqual({
      route: '/pricing', releaseKey: 'r2', deviceClass: 'phone', kind: 'rage',
      cells: [{ gx: 1, gy: 2, n: 3 }, { gx: 9, gy: 9, n: 4 }], total: 7,
    });
    expect(calls[0]!.params).toEqual(expect.arrayContaining([7, SITE, '/pricing', 'r2', 'phone', 'rage']));
  });

  it('defaults to clicks and refuses a missing route or an unknown kind', async () => {
    const { db, calls } = fakeDb(() => []);
    expect((await service(db).grid(SCOPE, { route: '/' })).kind).toBe('click');
    expect(calls[0]!.params).toContain('click');
    await expect(service(db).grid(SCOPE, {})).rejects.toMatchObject({ name: 'ValidationError' });
    await expect(service(db).grid(SCOPE, { route: '/', kind: 'hover' })).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

describe('elements', () => {
  it('ranks with rankHeatZones (recency beats raw volume) and reports the compare delta', async () => {
    const { db } = fakeDb((shape, params) => ('selector' in shape ? elementRows(params) : []));
    const rows = await service(db).elements(SCOPE, { route: '/pricing', release: 'r2', compare: 'r1' });

    expect(rankHeatZones).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rankHeatZones).mock.calls[0]![1]).toBe(NOW);
    expect(rows.map((r) => r.selector)).toEqual([BUY, OLD]);
    expect(rows[0]).toMatchObject({ label: 'Buy', clicks: 30, rage: 10, dead: 0, compareClicks: 20, delta: 0.5 });
    expect(rows[0]!.score).toBeCloseTo(heatScore(40, new Date('2026-10-11T00:00:00.000Z'), NOW), 2);
    // Not seen in the compare release: comparable count 0, no relative change.
    expect(rows[1]).toMatchObject({ clicks: 60, compareClicks: 0, delta: null });
  });

  it('leaves compare fields null without a compare release', async () => {
    const { db, calls } = fakeDb((shape, params) => ('selector' in shape ? elementRows(params) : []));
    const rows = await service(db).elements(SCOPE, { route: '/pricing', release: 'r2' });
    expect(rows.every((r) => r.compareClicks === null && r.delta === null)).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('scrollDepth', () => {
  it('turns deepest-decile counts into reach per decile', async () => {
    const { db, calls } = fakeDb(() => [{ gx: 0, gy: 0, n: '2' }, { gx: 0, gy: 5, n: '6' }, { gx: 0, gy: 9, n: '2' }]);
    const depth = await service(db).scrollDepth(SCOPE, { route: '/pricing' });
    expect(depth.sessions).toBe(10);
    expect(depth.reach).toEqual([1, 0.8, 0.8, 0.8, 0.8, 0.8, 0.2, 0.2, 0.2, 0.2]);
    expect(calls[0]!.params).toContain('scroll');
  });

  it('is all zeros with no samples', async () => {
    const { db } = fakeDb(() => []);
    expect(await service(db).scrollDepth(SCOPE, { route: '/x' })).toEqual({ route: '/x', sessions: 0, reach: new Array(10).fill(0) });
  });
});

describe('routes', () => {
  it('maps the top routes', async () => {
    const { db, calls } = fakeDb(() => [{ route: '/', sessions: '9', pageviews: '40' }]);
    expect(await service(db).routes(SCOPE, 14)).toEqual([{ route: '/', sessions: 9, pageviews: 40 }]);
    expect(calls[0]!.params).toEqual(expect.arrayContaining([7, SITE]));
  });
});

describe('snapshot', () => {
  it('names the newest recording on the route and its first STORED chunk', async () => {
    const startedAt = new Date('2026-10-11T09:00:00.000Z');
    const { db, calls } = fakeDb(() => [{ id: 'rec-1', tenantId: 7, siteId: SITE, startedAt }]);
    mocks.listChunkSeqs.mockResolvedValue([7, 8, 9]);
    expect(await service(db).snapshot(SCOPE, { route: '/pricing', release: 'r2' })).toEqual({ recordingId: 'rec-1', seq: 7 });
    expect(mocks.listChunkSeqs).toHaveBeenCalledWith({}, { tenantId: 7, siteId: SITE, recordingId: 'rec-1', startedAt });
    expect(calls[0]!.params).toEqual(expect.arrayContaining([7, SITE, 'r2']));
  });

  it('answers no recording when none visited the route', async () => {
    const { db } = fakeDb(() => []);
    expect(await service(db).snapshot(SCOPE, { route: '/pricing' })).toEqual({ recordingId: null, seq: 0 });
  });
});

describe('insights', () => {
  it('evaluates the rules over the route and the compare release', async () => {
    const { db } = fakeDb((shape, params) => {
      if ('selector' in shape) return elementRows(params);
      if ('pageviews' in shape) return [{ releaseKey: 'r2', pageviews: '100' }, { releaseKey: 'r1', pageviews: '100' }];
      return [];
    });
    const out = await service(db).insights(SCOPE, { route: '/pricing', release: 'r2', compare: 'r1' });
    expect(out).toEqual([{
      ruleId: 'rage_spike', route: '/pricing', selector: BUY,
      params: { rage: 10, compareRage: 3, ratio: 3.33, label: 'Buy' }, action: 'ticket',
    }]);
  });
});
