import { describe, expect, it } from 'vitest';
import type { EntityDestination, JournalEvent, LocalRecord } from './records.js';
import { applyRemote, cursorIncludes, decideCursor, tombstoneRecord } from './tombstone.js';

const DEST: EntityDestination = { kind: 'bound', accountId: 'acct-1', projectId: 'proj-1' };
const AT = '2026-10-19T12:00:00.000Z';

function record(partial: {
  id?: string;
  version: number;
  deletedAt?: string;
  destination?: EntityDestination;
  title?: string;
}): LocalRecord<{ title: string }> {
  return {
    id: partial.id ?? 'ticket-1',
    entityType: 'ticket',
    schemaVersion: 1,
    version: partial.version,
    destination: partial.destination ?? DEST,
    occurredAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    ...(partial.deletedAt ? { deletedAt: partial.deletedAt } : {}),
    payload: { title: partial.title ?? 'kept' },
  };
}

function event(
  localSequence: number,
  operation: JournalEvent['operation'],
): Pick<JournalEvent, 'localSequence' | 'operation'> {
  return { localSequence, operation };
}

describe('tombstoneRecord', () => {
  it('sets deletedAt, bumps version, and keeps id and destination', () => {
    const live = record({ version: 3, title: 'still here' });
    const tombstone = tombstoneRecord(live, AT);

    expect(tombstone.id).toBe(live.id);
    expect(tombstone.destination).toBe(DEST);
    expect(tombstone.destination).toEqual(live.destination);
    expect(tombstone.deletedAt).toBe(AT);
    expect(tombstone.version).toBe(4);
    expect(tombstone.baseVersion).toBe(3);
    expect(tombstone.updatedAt).toBe(AT);
    expect(tombstone.payload).toEqual({ title: 'still here' });
    expect(tombstone.entityType).toBe('ticket');
    expect(live.deletedAt).toBeUndefined();
    expect(live.version).toBe(3);
  });

  it('refuses a blank delete time or a non-finite version', () => {
    const live = record({ version: 1 });
    expect(() => tombstoneRecord(live, '   ')).toThrow('tombstone_at_required');
    expect(() => tombstoneRecord({ ...live, version: Number.NaN }, AT)).toThrow('tombstone_version_required');
  });
});

describe('applyRemote', () => {
  it('keeps a local tombstone when the pulled version is not newer', () => {
    const local = record({ version: 4, deletedAt: AT, title: 'gone' });
    const olderLive = record({ version: 3, title: 'resurrected' });
    const equalLive = record({ version: 4, title: 'same version' });
    const olderTombstone = record({ version: 2, deletedAt: '2026-10-18T00:00:00.000Z' });

    expect(applyRemote(local, olderLive)).toBe(local);
    expect(applyRemote(local, equalLive)).toBe(local);
    expect(applyRemote(local, olderTombstone)).toBe(local);
    expect(applyRemote(local, olderLive).deletedAt).toBe(AT);
  });

  it('does not resurrect a tombstone when a later pull is a newer live row', () => {
    const local = record({ version: 2, deletedAt: AT });
    const newerLive = record({ version: 9, title: 'back from the dead' });
    const merged = applyRemote(local, newerLive);

    expect(merged).toBe(local);
    expect(merged.deletedAt).toBe(AT);
    expect(merged.payload).toEqual({ title: 'kept' });
  });

  it('adopts a strictly newer remote tombstone instead of dropping the row', () => {
    const local = record({ version: 2, title: 'live' });
    const remote = record({ version: 3, deletedAt: AT, title: 'deleted remotely' });
    const merged = applyRemote(local, remote);

    expect(merged).toBe(remote);
    expect(merged.deletedAt).toBe(AT);
    expect(merged.id).toBe(local.id);
    expect(merged.version).toBe(3);
  });

  it('replaces an older local tombstone with a newer remote tombstone', () => {
    const local = record({ version: 2, deletedAt: '2026-10-18T00:00:00.000Z' });
    const remote = record({ version: 5, deletedAt: AT });
    expect(applyRemote(local, remote)).toBe(remote);
  });

  it('lets the higher version win when neither row is deleted, and keeps local on a tie', () => {
    const local = record({ version: 2, title: 'local' });
    const newer = record({ version: 3, title: 'remote' });
    const older = record({ version: 1, title: 'stale' });
    const tie = record({ version: 2, title: 'other device' });

    expect(applyRemote(local, newer)).toBe(newer);
    expect(applyRemote(local, older)).toBe(local);
    expect(applyRemote(local, tie)).toBe(local);
  });

  it('ignores a remote tombstone that is not strictly newer than a live local row', () => {
    const local = record({ version: 4, title: 'still live' });
    const olderDelete = record({ version: 3, deletedAt: AT });
    const equalDelete = record({ version: 4, deletedAt: AT });

    expect(applyRemote(local, olderDelete)).toBe(local);
    expect(applyRemote(local, equalDelete)).toBe(local);
    expect(applyRemote(local, olderDelete).deletedAt).toBeUndefined();
  });

  it('stores a pulled tombstone when the local row is missing', () => {
    const remote = record({ version: 1, deletedAt: AT, title: 'never seen' });
    const merged = applyRemote(undefined, remote);

    expect(merged).toBe(remote);
    expect(merged.deletedAt).toBe(AT);
    expect(merged.id).toBe('ticket-1');
  });

  it('refuses to merge a remote row onto a different id', () => {
    const local = record({ id: 'ticket-1', version: 1 });
    const remote = record({ id: 'ticket-2', version: 2 });
    expect(() => applyRemote(local, remote)).toThrow('tombstone_id_mismatch');
  });
});

describe('cursorIncludes', () => {
  const events = [
    event(5, 'update'),
    event(2, 'delete'),
    event(4, 'update'),
    event(1, 'create'),
    event(3, 'delete'),
  ];

  it('returns every event after the cursor, including tombstone operations', () => {
    expect(cursorIncludes(events, 1)).toEqual([
      event(2, 'delete'),
      event(3, 'delete'),
      event(4, 'update'),
      event(5, 'update'),
    ]);
  });

  it('does not skip a delete that sits between later writes', () => {
    const included = cursorIncludes(events, 2);
    expect(included.map((item) => item.operation)).toEqual(['delete', 'update', 'update']);
    expect(included.some((item) => item.operation === 'delete' && item.localSequence === 3)).toBe(true);
    expect(included.some((item) => item.localSequence <= 2)).toBe(false);
  });

  it('treats the cursor sequence as already applied, so a delete at the cursor is not replayed', () => {
    expect(cursorIncludes([event(4, 'delete'), event(5, 'update')], 4)).toEqual([event(5, 'update')]);
    expect(cursorIncludes([event(4, 'delete')], 4)).toEqual([]);
  });

  it('does not drop tombstone operations when the cursor is not a finite sequence', () => {
    const deletes = [event(1, 'delete'), event(2, 'delete')];
    expect(cursorIncludes(deletes, Number.NaN)).toEqual(deletes);
    expect(cursorIncludes(deletes, Number.POSITIVE_INFINITY)).toEqual(deletes);
  });

  it('still emits a tombstone whose own sequence is not finite', () => {
    const broken = event(Number.NaN, 'delete');
    expect(cursorIncludes([broken, event(1, 'create')], 0)).toEqual([event(1, 'create'), broken]);
  });
});

describe('decideCursor', () => {
  const changes = [
    event(1, 'create'),
    event(2, 'delete'),
    event(3, 'update'),
    event(4, 'delete'),
  ];

  it('resnapshots a null cursor and does not return a partial merge', () => {
    const plan = decideCursor({ cursor: null, changes });

    expect(plan).toEqual({ action: 'resnapshot' });
    expect(Object.keys(plan)).toEqual(['action']);
    expect(plan).not.toHaveProperty('changes');
    expect(plan).not.toHaveProperty('cursor');
    expect(plan).not.toHaveProperty('sequence');
    expect(JSON.stringify(plan)).not.toContain('delete');
    expect(JSON.stringify(plan)).not.toContain('0');
    expect(changes).toHaveLength(4);
  });

  it('resnapshots a bad cursor instead of starting at sequence 0', () => {
    const supplied = [event(1, 'delete')];
    for (const cursor of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const plan = decideCursor({ cursor: cursor as number, changes: supplied });
      expect(plan).toEqual({ action: 'resnapshot' });
      expect(plan).not.toHaveProperty('changes');
      expect(plan).not.toHaveProperty('sequence');
    }
    expect(decideCursor(null)).toEqual({ action: 'resnapshot' });
    expect(decideCursor(undefined)).toEqual({ action: 'resnapshot' });
  });

  it('resnapshots when expired even if the cursor and changes are usable', () => {
    const supplied = [event(8, 'delete')];
    const plan = decideCursor({ cursor: 4, changes: supplied, expired: true });

    expect(plan).toEqual({ action: 'resnapshot' });
    expect(Object.keys(plan)).toEqual(['action']);
    expect(JSON.stringify(plan)).not.toContain('delete');
    expect(JSON.stringify(plan)).not.toContain('8');
    expect(supplied).toEqual([event(8, 'delete')]);
  });

  it('applies only changes strictly after a valid cursor, including tombstones', () => {
    const plan = decideCursor({ cursor: 1, changes, expired: false });

    expect(plan).toEqual({
      action: 'apply',
      cursor: 1,
      changes: [event(2, 'delete'), event(3, 'update'), event(4, 'delete')],
    });
    if (plan.action !== 'apply') throw new Error('expected apply');
    expect(plan.changes.some((item) => item.localSequence <= 1)).toBe(false);
    expect(plan.changes.some((item) => item.operation === 'delete')).toBe(true);
    expect(plan.changes).not.toBe(changes);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.changes)).toBe(true);
  });

  it('treats cursor 0 as a real cursor, not a resnapshot and not a skipped delete', () => {
    const plan = decideCursor({ cursor: 0, changes });
    expect(plan.action).toBe('apply');
    if (plan.action !== 'apply') throw new Error('expected apply');
    expect(plan.cursor).toBe(0);
    expect(plan.changes.map((item) => item.operation)).toEqual(['create', 'delete', 'update', 'delete']);
  });

  it('does not replay a delete at the cursor or changes at or before it', () => {
    const plan = decideCursor({
      cursor: 4,
      changes: [event(4, 'delete'), event(5, 'update'), event(3, 'delete')],
    });
    expect(plan).toEqual({ action: 'apply', cursor: 4, changes: [event(5, 'update')] });
  });

  it('applies an empty change list without resnapshotting a usable cursor', () => {
    expect(decideCursor({ cursor: 7 })).toEqual({ action: 'apply', cursor: 7, changes: [] });
    expect(decideCursor({ cursor: 7, changes: null })).toEqual({ action: 'apply', cursor: 7, changes: [] });
  });

  it('does not apply a change whose sequence is not after the cursor', () => {
    const broken = event(Number.NaN, 'delete');
    const plan = decideCursor({ cursor: 0, changes: [broken, event(1, 'create')] });
    expect(plan).toEqual({ action: 'apply', cursor: 0, changes: [event(1, 'create')] });
  });
});
