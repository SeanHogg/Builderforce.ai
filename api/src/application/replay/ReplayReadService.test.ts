/**
 * The read service always applies the FULL scope (D17) — tenant AND site in every
 * statement — and pages recordings by a keyset cursor. The db is a fake that records
 * each WHERE, rendered to SQL + params with the real Postgres dialect.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({
  getMarks: vi.fn(async () => [{ kind: 'page', key: '/', atMs: 0 }]),
  getChunk: vi.fn(),
  listChunkSeqs: vi.fn(async () => [3, 4]),
}));
vi.mock('./replayChunkStore', () => ({ getMarks: mocks.getMarks, getChunk: mocks.getChunk, listChunkSeqs: mocks.listChunkSeqs }));

import { ReplayReadService } from './ReplayReadService';
import { encodeRecordingCursor } from './replayReadModel';
import type { RecordingRow } from './replayRecordingWriter';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const NOW = new Date('2026-10-12T10:00:00.000Z');
const dialect = new PgDialect();

function recording(i: number): RecordingRow {
  const at = new Date(NOW.getTime() - i * 60_000);
  return {
    id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}`, siteId: SITE, tenantId: 7,
    visitorId: 'visitor_0001', visitId: `visit_${String(i).padStart(6, '0')}`,
    startedAt: at, lastEventAt: at, endedAt: null, durationMs: 1_000, activeMs: 500,
    entryPath: '/', exitPath: '/x', pageCount: 2, releaseKey: 'r1', recorderVersion: '1.0.0',
    deviceClass: 'phone', viewportW: 390, viewportH: 844, browser: 'Safari', os: 'iOS', country: 'US', referrerHost: null,
    clickCount: 3, rageCount: 1, deadCount: 0, errorCount: 0, quickbackCount: 0, excessiveScrollCount: 0,
    converted: false, keepReason: 'frustration', sampleWeight: 1, variant: null, identifiedId: null, traits: null,
    billableUnits: 1, chunkCount: 2, bytes: 4_000, routes: ['/', '/x'], events: [], frustrations: ['rage'], clicked: [],
    issueFps: [], steps: [], tags: { plan: 'pro' }, createdAt: at, updatedAt: at,
  };
}

function fakeDb(rows: unknown[]) {
  const wheres: SQL[] = [];
  const limits: number[] = [];
  const chain = {
    from: () => chain,
    where: (cond: SQL) => { wheres.push(cond); return chain; },
    orderBy: () => chain,
    limit: async (n: number) => { limits.push(n); return rows; },
  };
  const db = { select: () => chain };
  return { db: db as never, wheres, limits };
}

const rendered = (cond: SQL) => dialect.sqlToQuery(cond);

let service: (db: never) => ReplayReadService;
beforeEach(() => {
  mocks.getMarks.mockClear();
  mocks.listChunkSeqs.mockClear();
  service = (db) => new ReplayReadService({} as never, db, () => NOW);
});

describe('listRecordings', () => {
  it('scopes to the tenant AND the site and asks for one row past the page', async () => {
    const { db, wheres, limits } = fakeDb([]);
    await service(db).listRecordings(SCOPE, { days: 7 });
    const { sql, params } = rendered(wheres[0]!);
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('"site_id"');
    expect(params).toContain(7);
    expect(params).toContain(SITE);
    expect(limits[0]).toBe(51);
  });

  it('maps rows to the DTO and returns a cursor when there is a next page', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => recording(i));
    const { db } = fakeDb(rows);
    const page = await service(db).listRecordings(SCOPE);
    expect(page.items).toHaveLength(50);
    expect(page.items[0]).toMatchObject({
      id: rows[0]!.id, deviceClass: 'phone', counts: { clicks: 3, rage: 1 }, keepReason: 'frustration', tags: { plan: 'pro' },
    });
    expect(page.nextCursor).toBe(encodeRecordingCursor(rows[49]!));
  });

  it('turns a cursor into a keyset predicate after the last row', async () => {
    const { db, wheres } = fakeDb([]);
    const cursor = encodeRecordingCursor(recording(49));
    await service(db).listRecordings(SCOPE, { cursor });
    const { sql, params } = rendered(wheres[0]!);
    expect(sql).toMatch(/\("replay_recordings"\."started_at", "replay_recordings"\."id"\) < \(\$\d+::timestamp, \$\d+::uuid\)/);
    expect(params).toContain(recording(49).id);
  });

  it('compiles the filter (THE compiler) into the same statement', async () => {
    const { db, wheres } = fakeDb([]);
    await service(db).listRecordings(SCOPE, { filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }, { field: 'durationMs', op: 'gte', value: 5_000 }] } });
    const { params } = rendered(wheres[0]!);
    expect(params).toEqual(expect.arrayContaining([7, SITE, 'phone', 5_000]));
  });
});

describe('getRecording', () => {
  it('reads the row inside the scope and attaches its timeline', async () => {
    const row = recording(1);
    const { db, wheres } = fakeDb([row]);
    const dto = await service(db).getRecording(SCOPE, row.id);
    expect(dto.marks).toEqual([{ kind: 'page', key: '/', atMs: 0 }]);
    expect(dto.viewport).toEqual({ w: 390, h: 844 });
    // A trigger-kept recording starts mid-visit: the stored seqs, not 0..chunkCount-1.
    expect(dto.chunkSeqs).toEqual([3, 4]);
    expect(dto.chunkCount).toBe(2);
    expect(mocks.listChunkSeqs).toHaveBeenCalledTimes(1);
    const { params } = rendered(wheres[0]!);
    expect(params).toEqual(expect.arrayContaining([7, SITE, row.id]));
  });

  it('is a 404 when the scope does not hold it, and for a malformed id', async () => {
    const { db } = fakeDb([]);
    await expect(service(db).getRecording(SCOPE, recording(1).id)).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(service(db).getRecording(SCOPE, 'nope')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('live', () => {
  it('counts visitors seen in the last minute, by route, inside the scope', async () => {
    const seen = new Date(NOW.getTime() - 10_000);
    const rows = [
      { siteId: SITE, tenantId: 7, visitId: 'v1', lastSeenAt: seen, route: '/a', deviceClass: 'desktop', x: 1, y: 2, recordingId: null },
      { siteId: SITE, tenantId: 7, visitId: 'v2', lastSeenAt: seen, route: '/a', deviceClass: 'phone', x: null, y: null, recordingId: 'r' },
      { siteId: SITE, tenantId: 7, visitId: 'v3', lastSeenAt: seen, route: '/b', deviceClass: 'phone', x: null, y: null, recordingId: null },
    ];
    const { db, wheres } = fakeDb(rows);
    const live = await service(db).live(SCOPE);
    expect(live.active).toBe(3);
    expect(live.byRoute).toEqual([{ route: '/a', n: 2 }, { route: '/b', n: 1 }]);
    expect(rendered(wheres[0]!).params).toEqual(expect.arrayContaining([7, SITE]));
  });
});
