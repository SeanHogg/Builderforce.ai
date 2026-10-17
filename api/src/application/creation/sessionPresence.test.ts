import { describe, expect, it } from 'vitest';
import {
  PRESENCE_ACTIVE_WINDOW_MS, PRESENCE_WRITE_THROTTLE_MS,
  jsonEquivalent, presenceWriteDue, resolvePresenceAccess,
  type NextPresence, type StoredPresence,
} from './sessionPresence';
import type { Db } from '../../infrastructure/database/connection';

const NOW = new Date('2026-10-17T12:00:00Z');

const next: NextPresence = {
  revision: 4,
  viewport: { x: 10, y: 20, zoom: 1 },
  cursor: { x: 1, y: 2 },
  selection: ['a'],
  typing: false,
  followingUserId: null,
};

/** What the last write left — same values, written `ageMs` ago, keys reordered the way JSONB stores them. */
const stored = (ageMs: number, overrides: Partial<StoredPresence> = {}): StoredPresence => ({
  lastSeenAt: new Date(NOW.getTime() - ageMs),
  lastSeenRevision: 4,
  viewport: { x: 10, y: 20, zoom: 1 },
  cursor: { y: 2, x: 1 },
  selection: ['a'],
  typing: false,
  followingUserId: null,
  ...overrides,
});

describe('presenceWriteDue', () => {
  it('keeps the throttle well inside the active window, so a skipped write never drops a present member', () => {
    expect(PRESENCE_WRITE_THROTTLE_MS * 2).toBeLessThanOrEqual(PRESENCE_ACTIVE_WINDOW_MS);
  });

  it('skips an unchanged tick written moments ago', () => {
    expect(presenceWriteDue(stored(8_000), next, NOW)).toBe(false);
  });

  it('writes once the stored row is as old as the throttle', () => {
    expect(presenceWriteDue(stored(PRESENCE_WRITE_THROTTLE_MS), next, NOW)).toBe(true);
  });

  it('writes when the revision moves (it drives the unread flag)', () => {
    expect(presenceWriteDue(stored(1_000), { ...next, revision: 5 }, NOW)).toBe(true);
  });

  it('writes when viewport, cursor, selection, typing or follow target change', () => {
    expect(presenceWriteDue(stored(1_000), { ...next, viewport: { x: 11, y: 20, zoom: 1 } }, NOW)).toBe(true);
    expect(presenceWriteDue(stored(1_000), { ...next, cursor: null }, NOW)).toBe(true);
    expect(presenceWriteDue(stored(1_000), { ...next, selection: [] }, NOW)).toBe(true);
    expect(presenceWriteDue(stored(1_000), { ...next, typing: true }, NOW)).toBe(true);
    expect(presenceWriteDue(stored(1_000), { ...next, followingUserId: 'u2' }, NOW)).toBe(true);
  });

  it('writes when the stored stamp is missing, unparseable or in the future', () => {
    expect(presenceWriteDue(stored(0, { lastSeenAt: null }), next, NOW)).toBe(true);
    expect(presenceWriteDue(stored(0, { lastSeenAt: 'not a date' }), next, NOW)).toBe(true);
    expect(presenceWriteDue(stored(-5_000), next, NOW)).toBe(true);
  });

  it('accepts an ISO-string stamp', () => {
    expect(presenceWriteDue(stored(0, { lastSeenAt: new Date(NOW.getTime() - 2_000).toISOString() }), next, NOW)).toBe(false);
  });
});

describe('jsonEquivalent', () => {
  it('ignores key order but not values or array order', () => {
    expect(jsonEquivalent({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(jsonEquivalent([1, 2], [2, 1])).toBe(false);
    expect(jsonEquivalent({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEquivalent(null, undefined)).toBe(true);
    expect(jsonEquivalent({}, [])).toBe(false);
  });
});

/** A `Db` double: each select resolves to the next queued row-set and records its column keys. */
function fakeDb(results: unknown[][]) {
  const columns: string[][] = [];
  const db = {
    select: (cols: Record<string, unknown>) => {
      columns.push(Object.keys(cols));
      const rows = results.shift() ?? [];
      const chain = {
        from: () => chain, innerJoin: () => chain, where: () => chain, limit: () => chain,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as Db;
  return { db, columns };
}

const ROW = {
  id: 's1', tenantId: 3, canvasRevision: 9, sessionViewport: { x: 0, y: 0, zoom: 1 }, role: 'editor',
  lastSeenAt: NOW, lastSeenRevision: 9, viewport: { x: 1, y: 1, zoom: 1 }, cursor: null, selection: [], typing: false, followingUserId: null,
};

describe('resolvePresenceAccess', () => {
  it('never selects the preview JSONB or any session column presence does not use', async () => {
    const { db, columns } = fakeDb([[ROW]]);
    await resolvePresenceAccess(db, 's1', 3, 'u1');
    expect(columns[0]).not.toContain('preview');
    expect(columns[0]).not.toContain('session');
  });

  it('answers from the tenant-scoped member read without a second query', async () => {
    const { db, columns } = fakeDb([[ROW]]);
    const access = await resolvePresenceAccess(db, 's1', 3, 'u1');
    expect(columns).toHaveLength(1);
    expect(access).toEqual({
      session: { id: 's1', tenantId: 3, canvasRevision: 9, viewport: { x: 0, y: 0, zoom: 1 } },
      role: 'editor',
      self: { lastSeenAt: NOW, lastSeenRevision: 9, viewport: { x: 1, y: 1, zoom: 1 }, cursor: null, selection: [], typing: false, followingUserId: null },
    });
  });

  it('falls through to the superadmin-member read, and refuses when neither matches', async () => {
    const admin = fakeDb([[], [ROW]]);
    expect((await resolvePresenceAccess(admin.db, 's1', 99, 'u1'))?.role).toBe('editor');
    expect(admin.columns).toHaveLength(2);

    const none = fakeDb([[], []]);
    expect(await resolvePresenceAccess(none.db, 's1', 99, 'u1')).toBeNull();
  });
});
