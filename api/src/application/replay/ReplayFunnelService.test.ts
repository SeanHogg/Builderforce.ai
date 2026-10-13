/**
 * Funnels: CRUD bound to the site, validated steps, and evaluation over kept
 * recordings read by keyset in batches of 500 (scope + compiled filter in every
 * batch), folded by `evaluateFunnel`, always ≈, `truncated` at the ceiling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({ bumpSiteVersion: vi.fn(async () => {}) }));
vi.mock('./replayCacheKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replayCacheKeys')>()),
  bumpSiteVersion: mocks.bumpSiteVersion,
}));

import { ReplayFunnelService, validateFunnelInput } from './ReplayFunnelService';
import { SCAN_BATCH } from './replayKeptScan';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const FUNNEL = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW = new Date('2026-10-12T10:00:00.000Z');
const dialect = new PgDialect();

const funnelRow = { id: FUNNEL, siteId: SITE, name: 'Checkout', windowMinutes: 30, createdBy: null, createdAt: new Date('2026-10-01T00:00:00Z') };
const stepRows = [
  { funnelId: FUNNEL, ord: 0, stepKind: 'page', match: '/', matchMode: 'equals' },
  { funnelId: FUNNEL, ord: 1, stepKind: 'page', match: '/checkout', matchMode: 'prefix' },
];

function recording(i: number, steps: string[]) {
  return {
    id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}`, visitorId: 'v', visitId: `visit_${i}`,
    startedAt: new Date(NOW.getTime() - i * 1_000), durationMs: 60_000, steps, clicked: [], sampleWeight: 1,
    converted: false, errorCount: 0, rageCount: 0, deadCount: 0, quickbackCount: 0, excessiveScrollCount: 0,
  };
}

/**
 * Selects are answered in order: funnels, steps, then scan batches. A batch answer
 * is sliced to the statement's `limit`, like a real database.
 */
function fakeDb(batches: unknown[][]) {
  const answers: unknown[][] = [[funnelRow], stepRows, ...batches];
  const wheres: SQL[] = [];
  const limits: number[] = [];
  let i = 0;
  const db = {
    select: () => {
      const rows = answers[i++] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'orderBy']) chain[m] = () => chain;
      chain.where = (w: SQL) => { wheres.push(w); return chain; };
      chain.limit = async (n: number) => { limits.push(n); return rows.slice(0, n); };
      chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
      return chain;
    },
  };
  return { db: db as never, wheres, limits };
}

const service = (db: never) => new ReplayFunnelService({} as never, db, () => NOW);

beforeEach(() => mocks.bumpSiteVersion.mockClear());

describe('validateFunnelInput', () => {
  it('needs 2–10 well-formed steps and a name', () => {
    expect(() => validateFunnelInput({ name: 'x', steps: [{ stepKind: 'page', match: '/', matchMode: 'equals' }] })).toThrow(/2–10 steps/);
    expect(() => validateFunnelInput({ name: '', steps: [] })).toThrow(/name/);
    expect(() => validateFunnelInput({ name: 'x', steps: [
      { stepKind: 'page', match: '/', matchMode: 'equals' },
      { stepKind: 'hover' as never, match: '/', matchMode: 'equals' },
    ] })).toThrow(/Step 2/);
    expect(validateFunnelInput({ name: ' Buy ', steps: [
      { stepKind: 'page', match: '/', matchMode: 'equals' },
      { stepKind: 'event', match: 'purchase', matchMode: 'equals' },
    ] })).toMatchObject({ name: 'Buy', windowMinutes: 30 });
  });
});

describe('list / get', () => {
  it('reads the site\'s funnels with their ordered, labelled steps', async () => {
    const { db, wheres } = fakeDb([]);
    const [funnel] = await service(db).list(SCOPE);
    expect(funnel).toEqual({
      id: FUNNEL, name: 'Checkout', windowMinutes: 30,
      steps: [
        { ord: 0, stepKind: 'page', match: '/', matchMode: 'equals', label: 'page: /' },
        { ord: 1, stepKind: 'page', match: '/checkout', matchMode: 'prefix', label: 'page: /checkout' },
      ],
    });
    expect(dialect.sqlToQuery(wheres[0]!).params).toEqual([SITE]);
  });

  it('is a 404 for a funnel not on this site', async () => {
    const { db } = fakeDb([]);
    await expect(service(db).get(SCOPE, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000000')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('evaluate', () => {
  it('scans kept recordings in scope by keyset batches and folds them (≈)', async () => {
    const batch1 = Array.from({ length: SCAN_BATCH + 1 }, (_, i) => recording(i, i % 2 ? ['page:/', 'page:/checkout/pay'] : ['page:/']));
    const batch2 = [recording(SCAN_BATCH, ['page:/', 'page:/checkout'])];
    const { db, wheres, limits } = fakeDb([batch1, batch2]);
    const out = await service(db).evaluate(SCOPE, FUNNEL, { days: 7, filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] } });
    expect(out.estimated).toBe(true);
    expect(out.truncated).toBe(false);
    expect(out.steps[0]!.visits).toBe(SCAN_BATCH + 1);
    expect(out.steps[1]!.visits).toBe(SCAN_BATCH / 2 + 1);
    expect(out.steps[1]!.droppedRecordingIds.length).toBeGreaterThan(0);
    // Two scan batches, each one past the page, each carrying scope + filter; the second after a keyset cursor.
    expect(limits.slice(-2)).toEqual([SCAN_BATCH + 1, SCAN_BATCH + 1]);
    const second = dialect.sqlToQuery(wheres[wheres.length - 1]!);
    expect(second.params).toEqual(expect.arrayContaining([7, SITE, 'phone']));
    expect(second.sql).toContain('("replay_recordings"."started_at", "replay_recordings"."id") <');
  });
});

describe('writes', () => {
  it('creates funnel + steps on the site and bumps its version', async () => {
    const inserted: unknown[] = [];
    const listChain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy']) listChain[m] = () => listChain;
    listChain.limit = async () => [];
    const db = {
      select: () => listChain,
      insert: () => ({ values: (v: unknown) => { inserted.push(v); return { returning: async () => (Array.isArray(v) ? v : [{ ...funnelRow }]) }; } }),
    };
    const dto = await service(db as never).create(SCOPE, { name: 'Checkout', steps: [
      { stepKind: 'page', match: '/', matchMode: 'equals' },
      { stepKind: 'click', match: 'button.pay', matchMode: 'contains' },
    ] }, 'u1');
    expect(inserted[0]).toMatchObject({ siteId: SITE, name: 'Checkout', windowMinutes: 30, createdBy: 'u1' });
    expect(inserted[1]).toEqual([
      { funnelId: FUNNEL, ord: 0, stepKind: 'page', match: '/', matchMode: 'equals' },
      { funnelId: FUNNEL, ord: 1, stepKind: 'click', match: 'button.pay', matchMode: 'contains' },
    ]);
    expect(dto.steps.map((s) => s.label)).toEqual(['page: /', 'click: button.pay']);
    expect(mocks.bumpSiteVersion).toHaveBeenCalledWith({}, SITE);
  });
});
