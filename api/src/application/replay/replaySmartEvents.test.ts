/**
 * Smart events: built-ins (one per name, id null) then the site's rules, every
 * count from ONE grouped statement inside the full scope using THE compiler's
 * predicates; a preview counts the rule alone; built-in names are reserved;
 * writes are bound to the site and bump its version.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { BUILTIN_SMART_EVENT_NAMES } from '@builderforce/interaction-contract';

const mocks = vi.hoisted(() => ({
  bumpSiteVersion: vi.fn(async () => {}),
  siteSmartEventRows: vi.fn(),
}));
vi.mock('./replayCacheKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replayCacheKeys')>()),
  bumpSiteVersion: mocks.bumpSiteVersion,
}));
vi.mock('./replaySmartEventRules', () => ({ siteSmartEventRows: mocks.siteSmartEventRows, MAX_SITE_SMART_EVENTS: 100 }));

import { createSmartEvent, deleteSmartEvent, listSmartEvents, previewSmartEvent, validateSmartEventInput } from './replaySmartEvents';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const RULE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const dialect = new PgDialect();
const env = {} as never;

function fakeDb(counts: Record<string, number> = {}, returning: unknown[] = [{ id: RULE_ID }]) {
  const selected: Array<Record<string, SQL>> = [];
  const wheres: SQL[] = [];
  const inserted: unknown[] = [];
  const db = {
    select: (cols: Record<string, SQL>) => {
      selected.push(cols);
      const chain = { from: () => chain, where: async (w: SQL) => { wheres.push(w); return [counts]; } };
      return chain;
    },
    insert: () => ({ values: (v: unknown) => { inserted.push(v); return { returning: async () => returning }; } }),
    delete: () => ({ where: (w: SQL) => { wheres.push(w); return { returning: async () => returning }; } }),
  };
  return { db: db as never, selected, wheres, inserted };
}

beforeEach(() => {
  mocks.bumpSiteVersion.mockClear();
  mocks.siteSmartEventRows.mockReset();
  mocks.siteSmartEventRows.mockResolvedValue([
    { id: RULE_ID, name: 'pricing', ruleKind: 'page', match: '/pricing', matchMode: 'prefix', createdAt: '2026-10-01T00:00:00.000Z' },
  ]);
});

describe('listSmartEvents', () => {
  it('lists one entry per built-in name then the site rules, counted in ONE scoped statement', async () => {
    const n = BUILTIN_SMART_EVENT_NAMES.length;
    const { db, selected, wheres } = fakeDb({ c0: 12.4, [`c${n}`]: 3 });
    const out = await listSmartEvents(env, db, SCOPE, { days: 7, now: new Date('2026-10-12T00:00:00Z') });
    expect(out).toHaveLength(n + 1);
    expect(out[0]).toMatchObject({ id: null, name: 'sign up', builtin: true, count: 12 });
    expect(out[n]).toMatchObject({ id: RULE_ID, name: 'pricing', builtin: false, count: 3 });
    expect(selected).toHaveLength(1);
    expect(Object.keys(selected[0]!)).toHaveLength(n + 1);
    expect(dialect.sqlToQuery(wheres[0]!).params).toEqual(expect.arrayContaining([7, SITE]));
    // The site rule's count uses the compiler's predicate over routes.
    const rule = dialect.sqlToQuery(selected[0]![`c${n}`]!);
    expect(rule.sql).toContain('unnest("replay_recordings"."routes")');
    expect(rule.params).toEqual(expect.arrayContaining(['/pricing%']));
  });
});

describe('previewSmartEvent', () => {
  it('counts the rule alone', async () => {
    const { db, selected } = fakeDb({ c0: 5 });
    expect(await previewSmartEvent(env, db, SCOPE, { ruleKind: 'click', match: 'Buy', matchMode: 'contains' })).toEqual({ count: 5 });
    const q = dialect.sqlToQuery(selected[0]!.c0!);
    expect(q.sql).toContain('unnest("replay_recordings"."clicked")');
    expect(q.sql).not.toContain('"replay_recordings"."events" @>');
    expect(q.params).toEqual(expect.arrayContaining(['%buy%']));
  });
});

describe('writes', () => {
  it('validates input and reserves built-in names', () => {
    expect(() => validateSmartEventInput({ name: 'Purchase', ruleKind: 'page', match: '/x', matchMode: 'equals' })).toThrow(/built-in/);
    expect(() => validateSmartEventInput({ name: 'x', ruleKind: 'scroll' as never, match: '/x', matchMode: 'equals' })).toThrow(/ruleKind/);
    expect(() => validateSmartEventInput({ name: 'x', ruleKind: 'page', match: ' ', matchMode: 'equals' })).toThrow(/match/);
  });

  it('creates a rule on the site and bumps its version', async () => {
    const { db, inserted } = fakeDb();
    const dto = await createSmartEvent(env, db, SCOPE, { name: 'Demo booked', ruleKind: 'custom', match: 'demo_booked', matchMode: 'equals' }, 'u1');
    expect(dto).toEqual({ id: RULE_ID, name: 'Demo booked', ruleKind: 'custom', match: 'demo_booked', matchMode: 'equals', builtin: false, count: 0 });
    expect(inserted[0]).toMatchObject({ siteId: SITE, createdBy: 'u1' });
    expect(mocks.bumpSiteVersion).toHaveBeenCalledWith(env, SITE);
  });

  it('deletes only within the site; another site\'s id is a 404', async () => {
    const hit = fakeDb();
    await deleteSmartEvent(env, hit.db, SCOPE, RULE_ID);
    expect(dialect.sqlToQuery(hit.wheres[0]!).params).toEqual([SITE, RULE_ID]);
    const miss = fakeDb({}, []);
    await expect(deleteSmartEvent(env, miss.db, SCOPE, RULE_ID)).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});
