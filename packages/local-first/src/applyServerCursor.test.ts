import { describe, expect, it } from 'vitest';
import type { EntityDestination, LocalRecord } from './records.js';
import {
  applyServerCursor,
  decodeServerCursor,
  type ApplyServerCursorResult,
} from './applyServerCursor.js';

const DEST: EntityDestination = { kind: 'bound', accountId: 'acct-1', projectId: 'proj-1' };
const DELETED_AT = '2026-10-19T12:00:00.000Z';

function encodeCursor(cursor: object): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function delta(seq: number): string {
  return encodeCursor({ v: 1, kind: 'delta', seq });
}

function record(partial: {
  id?: string;
  entityType?: LocalRecord['entityType'];
  version?: number;
  title?: string;
  deletedAt?: string;
}): LocalRecord<{ title: string }> {
  return {
    id: partial.id ?? 'ticket-1',
    entityType: partial.entityType ?? 'ticket',
    schemaVersion: 1,
    version: partial.version ?? 1,
    destination: DEST,
    occurredAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    ...(partial.deletedAt ? { deletedAt: partial.deletedAt } : {}),
    payload: { title: partial.title ?? 'local' },
  };
}

function asApplied(result: ApplyServerCursorResult<{ title: string }>) {
  expect(result.resnapshotRequired).toBe(false);
  if (result.resnapshotRequired) throw new Error('expected apply');
  return result;
}

function expectResnapshot(result: ApplyServerCursorResult<{ title: string }>, secret: string): void {
  expect(result).toEqual({ resnapshotRequired: true });
  expect(Object.keys(result)).toEqual(['resnapshotRequired']);
  expect(result).not.toHaveProperty('records');
  expect(result).not.toHaveProperty('applied');
  expect(result).not.toHaveProperty('deleted');
  expect(result).not.toHaveProperty('cursor');
  expect(result).not.toHaveProperty('sequence');
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('0');
}

describe('decodeServerCursor', () => {
  it('accepts a v1 delta and a v1 snapshot, and rejects a future version or a non-integer seq', () => {
    expect(decodeServerCursor(delta(0))).toEqual({ v: 1, kind: 'delta', seq: 0 });
    expect(decodeServerCursor(delta(4))).toEqual({ v: 1, kind: 'delta', seq: 4 });
    expect(decodeServerCursor(encodeCursor({
      v: 1,
      kind: 'snapshot',
      afterEntityType: 'ticket',
      afterClientEntityId: 'ticket-9',
    }))).toEqual({
      v: 1,
      kind: 'snapshot',
      afterEntityType: 'ticket',
      afterClientEntityId: 'ticket-9',
    });
    expect(decodeServerCursor(encodeCursor({ v: 2, kind: 'delta', seq: 1 }))).toBeNull();
    expect(decodeServerCursor(encodeCursor({ v: 1, kind: 'delta', seq: 1.5 }))).toBeNull();
    expect(decodeServerCursor(encodeCursor({ v: 1, kind: 'delta', seq: -1 }))).toBeNull();
    expect(decodeServerCursor('not-a-cursor')).toBeNull();
    expect(decodeServerCursor('0')).toBeNull();
    expect(decodeServerCursor('bfc1.0.00000000')).toBeNull();
  });
});

describe('applyServerCursor', () => {
  it('resnapshots a null or blank cursor and does not merge the page', () => {
    const local = [record({ title: 'kept-local' })];
    const changes = [{ clientEntityId: 'ticket-1', body: { title: 'secret-page' }, tombstone: false }];

    for (const cursor of [null, '', '   ', '\n\t']) {
      const result = applyServerCursor({ cursor, changes, local });
      expectResnapshot(result, 'secret-page');
    }
    expect(local[0].payload).toEqual({ title: 'kept-local' });
    expect(changes[0].body).toEqual({ title: 'secret-page' });
  });

  it('resnapshots a decode failure, a future version, and a non-integer seq without a partial merge', () => {
    const local = [record({ id: 'ticket-1', title: 'kept-local' })];
    const changes = [
      { clientEntityId: 'ticket-1', tombstone: true, deletedAt: DELETED_AT, body: { title: 'must-not-delete' } },
      { clientEntityId: 'ticket-2', body: { title: 'must-not-insert' } },
    ];
    const cursors = [
      '%%%',
      '0',
      encodeCursor({ v: 2, kind: 'delta', seq: 3 }),
      encodeCursor({ v: 1, kind: 'delta', seq: 1.5 }),
      encodeCursor({ v: 1, kind: 'delta', seq: -1 }),
      encodeCursor({ v: '1', kind: 'delta', seq: 1 }),
      'bfc1.3.deadbeef',
    ];

    for (const cursor of cursors) {
      const result = applyServerCursor({ cursor, changes, local });
      expectResnapshot(result, 'must-not-insert');
      expect(JSON.stringify(result)).not.toContain('must-not-delete');
      expect(JSON.stringify(result)).not.toContain('ticket-2');
    }
    expect(local).toHaveLength(1);
    expect(local[0].deletedAt).toBeUndefined();
    expect(local[0].payload).toEqual({ title: 'kept-local' });
  });

  it('resnapshots an expired or server-flagged page even when the cursor decodes', () => {
    const cursor = delta(9);
    const changes = [{ clientEntityId: 'ticket-1', body: { title: 'partial-merge' } }];
    const local = [record({ title: 'kept-local' })];

    expectResnapshot(applyServerCursor({ cursor, changes, local, expired: true }), 'partial-merge');
    expectResnapshot(
      applyServerCursor({ cursor, changes, local, resnapshotRequired: true }),
      'partial-merge',
    );
    expect(JSON.stringify(applyServerCursor({ cursor, changes, local, expired: true }))).not.toContain(cursor);
    expect(local[0].payload).toEqual({ title: 'kept-local' });
  });

  it('does not treat a rejected cursor as sequence 0', () => {
    const result = applyServerCursor({
      cursor: '0',
      changes: [{ clientEntityId: 'ticket-1', body: { title: 'replayed' } }],
      local: [],
    });
    expect(result).toEqual({ resnapshotRequired: true });
    expect(result).not.toHaveProperty('sequence');
    expect(JSON.stringify(result)).not.toContain('replayed');
  });

  it('applies a usable delta cursor, including sequence 0, and leaves the inputs untouched', () => {
    const local = [record({ id: 'ticket-1', title: 'local', version: 1 })];
    const changes = [
      { clientEntityId: 'ticket-1', entityType: 'ticket' as const, version: 2, body: { title: 'first' } },
      { clientEntityId: 'ticket-1', entityType: 'ticket' as const, version: 3, body: { title: 'second' } },
      { clientEntityId: 'ticket-2', entityType: 'ticket' as const, version: 1, body: { title: 'other' } },
    ];
    const cursor = delta(0);
    const applied = asApplied(applyServerCursor({ cursor, changes, local }));

    expect(applied.cursor).toBe(cursor);
    expect(applied.records.map((row) => row.id)).toEqual(['ticket-1', 'ticket-2']);
    expect(applied.records[0].payload).toEqual({ title: 'second' });
    expect(applied.records[0].version).toBe(3);
    expect(applied.records[1].payload).toEqual({ title: 'other' });
    expect(applied.applied.map((row) => row.op)).toEqual(['upsert', 'upsert', 'upsert']);
    expect(applied.deleted).toEqual([]);
    expect(applied.records[0]).not.toBe(local[0]);
    expect(local[0].payload).toEqual({ title: 'local' });
    expect(local[0].version).toBe(1);
    expect(changes[0].body).toEqual({ title: 'first' });
    expect(Object.isFrozen(applied)).toBe(true);
    expect(Object.isFrozen(applied.records)).toBe(true);
    expect(Object.isFrozen(applied.applied)).toBe(true);
  });

  it('deletes a local record for a tombstone flag and does not keep its body', () => {
    const local = [
      record({ id: 'ticket-1', title: 'live' }),
      record({ id: 'ticket-2', title: 'stay' }),
    ];
    const applied = asApplied(applyServerCursor({
      cursor: delta(4),
      local,
      changes: [{
        clientEntityId: 'ticket-1',
        entityType: 'ticket',
        tombstone: true,
        deletedAt: DELETED_AT,
        body: { title: 'gone' },
        payload: { title: 'also-gone' },
      }],
    }));

    expect(applied.records.map((row) => row.id)).toEqual(['ticket-2']);
    expect(applied.deleted).toEqual(['ticket-1']);
    expect(applied.applied).toEqual([{
      op: 'delete',
      id: 'ticket-1',
      entityType: 'ticket',
      deletedAt: DELETED_AT,
    }]);
    expect(JSON.stringify(applied.records)).not.toContain('gone');
    expect(applied.applied[0]).not.toHaveProperty('body');
    expect(applied.applied[0]).not.toHaveProperty('payload');
    expect(local[0].payload).toEqual({ title: 'live' });
    expect(local[0].deletedAt).toBeUndefined();
  });

  it('deletes on a non-blank deletedAt or a delete operation, and not on a blank deletedAt', () => {
    const byDeletedAt = asApplied(applyServerCursor({
      cursor: delta(1),
      local: [record({ id: 'ticket-1', title: 'live' })],
      changes: [{ clientEntityId: 'ticket-1', deletedAt: DELETED_AT, body: { title: 'hidden' } }],
    }));
    expect(byDeletedAt.records).toEqual([]);
    expect(byDeletedAt.deleted).toEqual(['ticket-1']);

    const byOperation = asApplied(applyServerCursor({
      cursor: delta(1),
      local: [record({ id: 'ticket-1', title: 'live' })],
      changes: [{ clientEntityId: 'ticket-1', operation: 'delete' }],
    }));
    expect(byOperation.records).toEqual([]);
    expect(byOperation.applied[0]).toMatchObject({ op: 'delete', id: 'ticket-1' });

    const blank = asApplied(applyServerCursor({
      cursor: delta(1),
      local: [record({ id: 'ticket-1', title: 'live' })],
      changes: [{ clientEntityId: 'ticket-1', entityType: 'ticket', deletedAt: '   ', body: { title: 'still' } }],
    }));
    expect(blank.deleted).toEqual([]);
    expect(blank.records[0].payload).toEqual({ title: 'still' });
    expect(blank.records[0].deletedAt).toBeUndefined();
  });

  it('applies server records first, then changes, so a later tombstone deletes the page record', () => {
    const serverRecord = record({ id: 'ticket-1', title: 'from-sync-records', version: 2 });
    const applied = asApplied(applyServerCursor({
      cursor: delta(8),
      local: [record({ id: 'ticket-1', title: 'local', version: 1 })],
      records: [serverRecord, record({ id: 'ticket-3', title: 'snapshot', version: 1 })],
      changes: [
        { clientEntityId: 'ticket-1', entityType: 'ticket', tombstone: true, deletedAt: DELETED_AT },
        { clientEntityId: 'ticket-4', entityType: 'project', version: 1, body: { title: 'new' } },
      ],
    }));

    expect(applied.records.map((row) => [row.entityType, row.id, row.payload.title])).toEqual([
      ['ticket', 'ticket-3', 'snapshot'],
      ['project', 'ticket-4', 'new'],
    ]);
    expect(applied.deleted).toEqual(['ticket-1']);
    expect(applied.applied.map((row) => row.op)).toEqual(['upsert', 'upsert', 'delete', 'upsert']);
    expect(serverRecord.payload).toEqual({ title: 'from-sync-records' });
  });

  it('a later upsert after a tombstone in the same page wins, in order', () => {
    const applied = asApplied(applyServerCursor({
      cursor: delta(2),
      local: [record({ id: 'ticket-1', title: 'local' })],
      changes: [
        { clientEntityId: 'ticket-1', entityType: 'ticket', tombstone: true, deletedAt: DELETED_AT },
        { clientEntityId: 'ticket-1', entityType: 'ticket', version: 5, body: { title: 'restored' } },
      ],
    }));

    expect(applied.deleted).toEqual([]);
    expect(applied.records).toHaveLength(1);
    expect(applied.records[0].payload).toEqual({ title: 'restored' });
    expect(applied.records[0].version).toBe(5);
    expect(applied.applied.map((row) => row.op)).toEqual(['delete', 'upsert']);
  });

  it('a tombstone without entityType deletes every local row with that id', () => {
    const applied = asApplied(applyServerCursor({
      cursor: delta(3),
      local: [
        record({ id: 'shared', entityType: 'ticket', title: 'ticket' }),
        record({ id: 'shared', entityType: 'project', title: 'project' }),
        record({ id: 'other', title: 'stay' }),
      ],
      changes: [{ clientEntityId: 'shared', tombstone: true }],
    }));

    expect(applied.records.map((row) => row.id)).toEqual(['other']);
    expect(applied.deleted).toEqual(['shared']);
  });

  it('a tombstone with an entityType does not delete a different type', () => {
    const applied = asApplied(applyServerCursor({
      cursor: delta(3),
      local: [
        record({ id: 'shared', entityType: 'ticket', title: 'ticket' }),
        record({ id: 'shared', entityType: 'project', title: 'project' }),
      ],
      changes: [{ clientEntityId: 'shared', entityType: 'ticket', tombstone: true }],
    }));

    expect(applied.records.map((row) => row.entityType)).toEqual(['project']);
    expect(applied.records[0].payload).toEqual({ title: 'project' });
  });

  it('drops a tombstoned sync_record instead of storing its payload', () => {
    const applied = asApplied(applyServerCursor({
      cursor: delta(6),
      records: [record({ id: 'ticket-1', title: 'should-vanish', deletedAt: DELETED_AT })],
      local: [record({ id: 'ticket-1', title: 'local' })],
    }));

    expect(applied.records).toEqual([]);
    expect(applied.deleted).toEqual(['ticket-1']);
    expect(JSON.stringify(applied)).not.toContain('should-vanish');
  });

  it('applies a snapshot cursor as a bootstrap page, not a resnapshot', () => {
    const cursor = encodeCursor({
      v: 1,
      kind: 'snapshot',
      afterEntityType: 'ticket',
      afterClientEntityId: 'ticket-1',
    });
    const applied = asApplied(applyServerCursor({
      cursor,
      records: [record({ id: 'ticket-1', title: 'boot' })],
    }));

    expect(applied.cursor).toBe(cursor);
    expect(applied.records[0].payload).toEqual({ title: 'boot' });
    expect(decodeServerCursor(cursor)?.kind).toBe('snapshot');
  });

  it('returns a copy of local records when the page is empty', () => {
    const local = [record({ id: 'ticket-1', title: 'quiet' })];
    const applied = asApplied(applyServerCursor({ cursor: delta(11), local, changes: [], records: [] }));

    expect(applied.records).toEqual(local);
    expect(applied.records[0]).not.toBe(local[0]);
    expect(applied.applied).toEqual([]);
    expect(applied.deleted).toEqual([]);
  });
});
