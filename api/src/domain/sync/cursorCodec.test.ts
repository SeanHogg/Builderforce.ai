import { describe, expect, it } from 'vitest';
import {
  RESNAPSHOT_REQUIRED,
  admitCursor,
  applyTombstone,
  decodeCursor,
  decodeSyncCursor,
  encodeCursor,
  encodeSyncCursor,
  pullChanges,
} from './cursorCodec';

const FIRST = '2026-10-19T00:00:00.000Z';
const LATER = '2026-10-19T01:00:00.000Z';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a sequence, including zero, and does not emit the digit string', () => {
    expect(decodeCursor(encodeCursor(0))).toBe(0);
    expect(decodeCursor(encodeCursor(1))).toBe(1);
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(encodeCursor(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(encodeCursor(0)).not.toBe('0');
    expect(encodeCursor(0).startsWith('bfc1.')).toBe(true);
    expect(encodeCursor(9)).toBe(encodeCursor(9));
  });

  it('returns null for anything encodeCursor did not produce, never 0, and does not throw', () => {
    const bad: unknown[] = [
      '0',
      '1',
      '42',
      '',
      ' ',
      'null',
      'undefined',
      'bfc1.0',
      'bfc1.0.00000000',
      'bfc1.00.00000000',
      '{"v":1,"s":0}',
      encodeCursor(5).slice(0, -1),
      `${encodeCursor(5)}x`,
      encodeCursor(7).replace('bfc1.', 'bfc2.'),
      0,
      1,
      null,
      undefined,
      Number.NaN,
      { s: 0 },
    ];
    for (const value of bad) {
      expect(decodeCursor(value)).toBeNull();
    }
  });

  it('rejects a cursor whose checksum was edited, instead of reading a nearby sequence', () => {
    const cursor = encodeCursor(9);
    const flipped = `${cursor.slice(0, -1)}${cursor.endsWith('0') ? '1' : '0'}`;
    expect(flipped).not.toBe(cursor);
    expect(decodeCursor(flipped)).toBeNull();
  });

  it('refuses to encode a value that is not a non-negative safe integer', () => {
    expect(() => encodeCursor(Number.NaN)).toThrow('cursor_not_a_sequence');
    expect(() => encodeCursor(Number.POSITIVE_INFINITY)).toThrow('cursor_not_a_sequence');
    expect(() => encodeCursor(-1)).toThrow('cursor_not_a_sequence');
    expect(() => encodeCursor(1.5)).toThrow('cursor_not_a_sequence');
    expect(() => encodeCursor(Number.MAX_SAFE_INTEGER + 1)).toThrow('cursor_not_a_sequence');
  });
});

describe('applyTombstone', () => {
  it('sets deletedAt, removes body, and does not mutate the live row', () => {
    const live = { id: 'ticket-1', seq: 4, version: 2, body: { title: 'secret' }, updatedAt: '2026-10-18T00:00:00.000Z' };
    const tombstone = applyTombstone(live, FIRST);

    expect(tombstone.deletedAt).toBe(FIRST);
    expect(tombstone.id).toBe('ticket-1');
    expect(tombstone.seq).toBe(4);
    expect(tombstone.version).toBe(2);
    expect(tombstone.updatedAt).toBe(live.updatedAt);
    expect('body' in tombstone).toBe(false);
    expect(live.body).toEqual({ title: 'secret' });
    expect('deletedAt' in live).toBe(false);
  });

  it('keeps the first deletedAt when applied twice, and still has no body', () => {
    const live = { id: 'ticket-1', body: { title: 'secret' } };
    const once = applyTombstone(live, FIRST);
    const twice = applyTombstone(once, LATER);
    const third = applyTombstone(twice, '2026-10-19T02:00:00.000Z');

    expect(once.deletedAt).toBe(FIRST);
    expect(twice.deletedAt).toBe(FIRST);
    expect(third.deletedAt).toBe(FIRST);
    expect('body' in once).toBe(false);
    expect('body' in twice).toBe(false);
    expect('body' in third).toBe(false);
  });

  it('strips a leftover body without moving an existing deletedAt', () => {
    const already = { id: 'ticket-1', deletedAt: FIRST, body: { title: 'should go' } };
    const applied = applyTombstone(already, LATER);

    expect(applied.deletedAt).toBe(FIRST);
    expect(applied.id).toBe('ticket-1');
    expect('body' in applied).toBe(false);
    expect(already.body).toEqual({ title: 'should go' });
  });

  it('refuses a blank delete time on a live row', () => {
    expect(() => applyTombstone({ id: 'ticket-1', body: { title: 'secret' } }, '   ')).toThrow(
      'tombstone_deleted_at_required',
    );
  });
});

describe('pullChanges', () => {
  it('returns a tombstone in the page, including one that still has a body, and does not skip it for a later write', () => {
    const stripped = applyTombstone({ seq: 3, id: 'a', body: { secret: true } }, FIRST);
    const stillHasBody = { seq: 4, id: 'b', deletedAt: FIRST, body: { secret: true } };
    const later = { seq: 5, id: 'c', body: { title: 'live' } };
    const page = pullChanges(
      [later, stillHasBody, stripped, { seq: 1, id: 'old', deletedAt: FIRST }],
      encodeCursor(2),
    );

    expect(page).toEqual({
      changes: [stripped, stillHasBody, later],
      cursor: encodeCursor(5),
    });
    expect(page?.changes.some((change) => change.id === 'a' && 'deletedAt' in change && change.deletedAt === FIRST)).toBe(true);
    expect(page?.changes.some((change) => change.seq <= 2)).toBe(false);
  });

  it('still returns a delete that is the only change after the cursor', () => {
    const only = { seq: 8, id: 'gone', deletedAt: FIRST };
    expect(pullChanges([only, { seq: 2, id: 'before', body: { title: 'old' } }], encodeCursor(7))).toEqual({
      changes: [only],
      cursor: encodeCursor(8),
    });
  });

  it('does not treat a bad cursor as zero, so an early tombstone is not replayed as a fresh pull', () => {
    const early = { seq: 1, id: 'gone', deletedAt: FIRST };
    expect(pullChanges([early], '0')).toBeNull();
    expect(pullChanges([early], '')).toBeNull();
    expect(pullChanges([early], 'bfc1.0.00000000')).toBeNull();
    expect(decodeCursor('0')).toBeNull();
  });

  it('treats a tombstone at the cursor as already applied, and advances the next cursor past one that was returned', () => {
    const atCursor = { seq: 4, id: 'applied', deletedAt: FIRST };
    const after = { seq: 5, id: 'next', deletedAt: LATER };
    expect(pullChanges([atCursor, after], encodeCursor(4))).toEqual({
      changes: [after],
      cursor: encodeCursor(5),
    });
    expect(pullChanges([atCursor], encodeCursor(4))).toEqual({
      changes: [],
      cursor: encodeCursor(4),
    });
  });
});

function rawCursor(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('encodeSyncCursor / decodeSyncCursor', () => {
  it('round-trips a delta and a snapshot, including sequence 0, and is not the digit string', () => {
    const delta = encodeSyncCursor({ v: 1, kind: 'delta', seq: 0 });
    const later = encodeSyncCursor({ v: 1, kind: 'delta', seq: 11 });
    const snapshot = encodeSyncCursor({ v: 1, kind: 'snapshot', afterEntityType: 'ticket', afterClientEntityId: 'ticket-1' });

    expect(decodeSyncCursor(delta)).toEqual({ v: 1, kind: 'delta', seq: 0 });
    expect(decodeSyncCursor(later)).toEqual({ v: 1, kind: 'delta', seq: 11 });
    expect(decodeSyncCursor(snapshot)).toEqual({
      v: 1,
      kind: 'snapshot',
      afterEntityType: 'ticket',
      afterClientEntityId: 'ticket-1',
    });
    expect(delta).not.toBe('0');
    expect(delta.startsWith('bfc1.')).toBe(false);
    expect(decodeCursor(delta)).toBeNull();
    expect(decodeSyncCursor(encodeCursor(3))).toBeNull();
  });

  it('returns null for a bad cursor, never 0, and does not throw', () => {
    const rejected = [
      '0',
      '',
      '   ',
      'not-a-cursor',
      'bfc1.3.deadbeef',
      encodeCursor(4),
      rawCursor({ v: 2, kind: 'delta', seq: 1 }),
      rawCursor({ v: 1, kind: 'delta', seq: 1.5 }),
      rawCursor({ v: 1, kind: 'delta', seq: -1 }),
      rawCursor({ v: 1, kind: 'delta', seq: Number.NaN }),
    ];
    for (const cursor of rejected) {
      expect(decodeSyncCursor(cursor)).toBeNull();
    }
  });
});

describe('admitCursor', () => {
  const secret = [{ seq: 1, id: 'ticket-1', title: 'must-not-leak' }];

  it('returns only the frozen resnapshot flag for a bad or expired cursor', () => {
    const delta = encodeSyncCursor({ v: 1, kind: 'delta', seq: 8 });
    const refused = [
      admitCursor(null),
      admitCursor(undefined),
      admitCursor(''),
      admitCursor('0'),
      admitCursor('bfc1.0.deadbeef'),
      admitCursor(encodeSyncCursor({ v: 1, kind: 'snapshot', afterEntityType: 'ticket', afterClientEntityId: 'a' }), {
        requireDelta: true,
      }),
      admitCursor(delta, { retainedThroughSeq: 9 }),
      admitCursor(delta, { expired: true }),
      admitCursor(encodeSyncCursor({ v: 1, kind: 'delta', seq: 1 }), { retainedThroughSeq: Number.NaN }),
      admitCursor(encodeSyncCursor({ v: 1, kind: 'delta', seq: 1 }), { retainedThroughSeq: Number.POSITIVE_INFINITY }),
    ];
    for (const result of refused) {
      expect(result).toBe(RESNAPSHOT_REQUIRED);
      expect(result).toEqual({ resnapshotRequired: true });
      expect(Object.keys(result)).toEqual(['resnapshotRequired']);
      expect(Object.isFrozen(result)).toBe(true);
      expect(JSON.stringify(result)).not.toContain('0');
      expect(JSON.stringify(result)).not.toContain('must-not-leak');
    }
    expect(secret).toHaveLength(1);
  });

  it('admits a cursor inside the retained window, including sequence 0 and a missing bound', () => {
    const zero = admitCursor(encodeSyncCursor({ v: 1, kind: 'delta', seq: 0 }), { retainedThroughSeq: 0 });
    expect(zero).toEqual({ resnapshotRequired: false, cursor: { v: 1, kind: 'delta', seq: 0 } });

    const equal = admitCursor(encodeSyncCursor({ v: 1, kind: 'delta', seq: 10 }), { retainedThroughSeq: 10 });
    expect(equal).toMatchObject({ resnapshotRequired: false, cursor: { seq: 10 } });

    const unbound = admitCursor(encodeSyncCursor({ v: 1, kind: 'delta', seq: 3 }), { retainedThroughSeq: null });
    expect(unbound).toMatchObject({ resnapshotRequired: false, cursor: { kind: 'delta', seq: 3 } });
  });
});
