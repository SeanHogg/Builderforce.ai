/**
 * Saved segments: validated by the contract AND the compiler, unique per site,
 * bound to the site in every statement, cached reads, version bump on writes.
 * Filter options: one grouped statement per field inside the full scope, capped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({ bumpSiteVersion: vi.fn(async () => {}) }));
vi.mock('./replayCacheKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replayCacheKeys')>()),
  bumpSiteVersion: mocks.bumpSiteVersion,
}));

import { createSegment, deleteSegment, listSegments, updateSegment } from './replaySegments';
import { FILTER_OPTION_FIELDS, FILTER_OPTIONS_MAX, filterOptions } from './replayFilterOptions';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const SEG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const dialect = new PgDialect();
const env = {} as never;

function segmentRow(name: string) {
  return { id: SEG, siteId: SITE, name, filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] }, createdBy: 'u1', createdAt: new Date('2026-10-01T00:00:00Z') };
}

function fakeDb(opts: { list?: unknown[]; insertError?: unknown; returning?: unknown[] } = {}) {
  const wheres: SQL[] = [];
  const inserted: unknown[] = [];
  const selects = { n: 0 };
  const chain = {
    from: () => chain,
    where: (w: SQL) => { wheres.push(w); return chain; },
    orderBy: () => chain,
    limit: async () => opts.list ?? [],
  };
  const writer = {
    values: (v: unknown) => { inserted.push(v); return writer; },
    set: (v: unknown) => { inserted.push(v); return writer; },
    where: (w: SQL) => { wheres.push(w); return writer; },
    returning: async () => {
      if (opts.insertError) throw opts.insertError;
      return opts.returning ?? [];
    },
  };
  const db = {
    select: () => { selects.n++; return chain; },
    insert: () => writer,
    update: () => writer,
    delete: () => writer,
  };
  return { db: db as never, wheres, inserted, selects };
}

beforeEach(() => mocks.bumpSiteVersion.mockClear());

describe('segments', () => {
  it('lists the site\'s segments (bound to the site) as DTOs', async () => {
    const { db, wheres } = fakeDb({ list: [segmentRow('Phones')] });
    const out = await listSegments(env, db, SCOPE);
    expect(out).toEqual([{ id: SEG, name: 'Phones', filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] }, createdAt: '2026-10-01T00:00:00.000Z' }]);
    expect(dialect.sqlToQuery(wheres[0]!).params).toEqual([SITE]);
  });

  it('creates a segment with a validated filter and bumps the site version', async () => {
    const { db, inserted } = fakeDb({ returning: [segmentRow('Phones')] });
    const dto = await createSegment(env, db, SCOPE, { name: '  Phones ', filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] }, userId: 'u1' });
    expect(dto.name).toBe('Phones');
    expect(inserted[0]).toMatchObject({ siteId: SITE, name: 'Phones', createdBy: 'u1' });
    expect(mocks.bumpSiteVersion).toHaveBeenCalledWith(env, SITE);
  });

  it('refuses an invalid filter, an empty name, and a duplicate name (409)', async () => {
    const { db } = fakeDb();
    await expect(createSegment(env, db, SCOPE, { name: 'x', filter: { all: [{ field: 'nope', op: 'eq', value: 1 }] }, userId: null }))
      .rejects.toMatchObject({ name: 'ValidationError' });
    await expect(createSegment(env, db, SCOPE, { name: '  ', filter: { all: [] }, userId: null }))
      .rejects.toMatchObject({ name: 'ValidationError' });
    const dup = fakeDb({ insertError: Object.assign(new Error('duplicate key value violates unique constraint "uq_replay_segments_name"'), { code: '23505' }) });
    await expect(createSegment(env, dup.db, SCOPE, { name: 'Phones', filter: { all: [] }, userId: null }))
      .rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('renames within the site, and is a 404 for a segment elsewhere', async () => {
    const ok = fakeDb({ returning: [segmentRow('Mobile')] });
    expect((await updateSegment(env, ok.db, SCOPE, SEG, { name: 'Mobile' })).name).toBe('Mobile');
    expect(dialect.sqlToQuery(ok.wheres[0]!).params).toEqual([SITE, SEG]);
    const none = fakeDb({ returning: [] });
    await expect(updateSegment(env, none.db, SCOPE, SEG, { name: 'Mobile' })).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(deleteSegment(env, none.db, SCOPE, SEG)).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('filterOptions', () => {
  function optionsDb() {
    const wheres: SQL[] = [];
    const executed: SQL[] = [];
    const chain = {
      from: () => chain,
      where: (w: SQL) => { wheres.push(w); return chain; },
      groupBy: () => chain,
      orderBy: () => chain,
      limit: async (n: number) => { expect(n).toBe(FILTER_OPTIONS_MAX); return [{ value: 'Safari', n: 3 }, { value: null, n: 9 }]; },
    };
    const db = {
      select: () => chain,
      execute: async (q: SQL) => { executed.push(q); return { rows: [{ value: 'purchase', n: 2 }] }; },
    };
    return { db: db as never, wheres, executed };
  }

  it('answers every open-vocabulary field, scoped to tenant AND site, dropping empty values', async () => {
    const { db, wheres, executed } = optionsDb();
    const out = await filterOptions(env, db, SCOPE, { days: 7, now: new Date('2026-10-12T00:00:00Z') });
    expect(out.map((o) => o.field)).toEqual([...FILTER_OPTION_FIELDS]);
    expect(out.find((o) => o.field === 'browser')!.values).toEqual([{ value: 'Safari', count: 3 }]);
    expect(out.find((o) => o.field === 'smartEvent')!.values).toEqual([{ value: 'purchase', count: 2 }]);
    for (const w of wheres) expect(dialect.sqlToQuery(w).params).toEqual(expect.arrayContaining([7, SITE]));
    const raw = dialect.sqlToQuery(executed[0]!);
    expect(raw.sql).toContain('unnest("replay_recordings"."events") as bf_opt(v)');
    expect(raw.params).toEqual(expect.arrayContaining([7, SITE, FILTER_OPTIONS_MAX]));
  });

  it('narrows to one field when asked', async () => {
    const { db } = optionsDb();
    const out = await filterOptions(env, db, SCOPE, { field: 'tag' });
    expect(out.map((o) => o.field)).toEqual(['tag']);
  });
});
