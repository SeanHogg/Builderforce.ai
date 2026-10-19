import { describe, expect, it } from 'vitest';
import { decodeSyncCursor, encodeSyncCursor } from '../../domain/sync/cursorCodec';
import {
  readPullCursor,
  type LocalDeleteInstruction,
  type LocalUpsertInstruction,
  type PullCursorReadPage,
  type PullCursorReadResult,
} from './pullCursorRead';

const DELETED_AT = '2026-10-19T12:00:00.000Z';
const SECRET = 'must-not-leak';

function delta(seq: number): string {
  return encodeSyncCursor({ v: 1, kind: 'delta', seq });
}

function snapshot(afterEntityType: string, afterClientEntityId: string): string {
  return encodeSyncCursor({ v: 1, kind: 'snapshot', afterEntityType, afterClientEntityId });
}

/** A cursor the codec must reject: future `v`, non-integer `seq`, or not our JSON. */
function rawCursor(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function asPage<T>(result: PullCursorReadResult<T>): PullCursorReadPage<T> {
  expect(result).not.toHaveProperty('resnapshotRequired');
  if ('resnapshotRequired' in result) throw new Error('expected a pull page');
  return result;
}

function asDelete(instruction: { op: string }): LocalDeleteInstruction {
  expect(instruction.op).toBe('delete');
  return instruction as LocalDeleteInstruction;
}

function expectResnapshot(result: PullCursorReadResult<unknown>): void {
  expect(result).toEqual({ resnapshotRequired: true });
  expect(Object.keys(result)).toEqual(['resnapshotRequired']);
  expect(result).not.toHaveProperty('instructions');
  expect(result).not.toHaveProperty('cursor');
  expect(result).not.toHaveProperty('deleted');
  expect(result).not.toHaveProperty('seq');
  const encoded = JSON.stringify(result);
  expect(encoded).not.toContain(SECRET);
  expect(encoded).not.toContain('ticket-1');
  expect(encoded).not.toContain('0');
}

describe('readPullCursor', () => {
  const leaked = [{ seq: 1, entityType: 'ticket' as const, clientEntityId: 'ticket-1', payload: { title: SECRET } }];

  it('resnapshots a missing input instead of reading rows', () => {
    expectResnapshot(readPullCursor(null));
    expectResnapshot(readPullCursor(undefined));
  });

  it('resnapshots a null or blank cursor instead of treating it as sequence 0', () => {
    for (const cursor of [null, undefined, '', '   ', '\n\t']) {
      const result = readPullCursor({ cursor, changes: leaked, retainedThroughSeq: 0 });
      expectResnapshot(result);
    }
    expect(leaked).toHaveLength(1);
    expect(leaked[0]?.payload).toEqual({ title: SECRET });
  });

  it('resnapshots a cursor decodeSyncCursor rejects, including a future v and a non-integer seq', () => {
    const rejected = [
      '0',
      'not-a-cursor',
      'bfc1.3.deadbeef',
      rawCursor({ v: 2, kind: 'delta', seq: 1 }),
      rawCursor({ v: 1, kind: 'delta', seq: 1.5 }),
      rawCursor({ v: 1, kind: 'delta', seq: -1 }),
      rawCursor({ v: 1, kind: 'delta', seq: Number.NaN }),
    ];
    for (const cursor of rejected) {
      expect(decodeSyncCursor(cursor)).toBeNull();
      const result = readPullCursor({ cursor, changes: leaked, records: leaked, retainedThroughSeq: 0 });
      expectResnapshot(result);
    }
    expect(leaked.map((row) => row.seq)).toEqual([1]);
  });

  it('resnapshots an expired cursor and does not return a partial page', () => {
    const changes = [
      { seq: 9, entityType: 'ticket' as const, clientEntityId: 'swept', payload: { title: SECRET } },
      { seq: 11, entityType: 'ticket' as const, clientEntityId: 'ticket-1', payload: { title: `${SECRET}-later` } },
    ];
    expectResnapshot(readPullCursor({ cursor: delta(8), changes, retainedThroughSeq: 9, expired: false }));
    expectResnapshot(readPullCursor({ cursor: delta(8), changes, expired: true }));
    expectResnapshot(readPullCursor({ cursor: delta(1), changes, retainedThroughSeq: Number.NaN }));
    expectResnapshot(readPullCursor({ cursor: delta(1), changes, retainedThroughSeq: Number.POSITIVE_INFINITY }));
    expect(changes).toHaveLength(2);
    expect(changes[1]?.payload).toEqual({ title: `${SECRET}-later` });
  });

  it('does not treat a missing retention bound as sequence 0', () => {
    const page = asPage(readPullCursor({
      cursor: delta(3),
      changes: [{ seq: 4, entityType: 'ticket', clientEntityId: 'ticket-4', payload: { title: 'after' } }],
      retainedThroughSeq: null,
    }));
    expect(page.instructions.map((instruction) => instruction.clientEntityId)).toEqual(['ticket-4']);
    expect(decodeSyncCursor(page.cursor)).toEqual({ v: 1, kind: 'delta', seq: 4 });
  });

  it('serves a real sequence 0 cursor without confusing it with the string "0"', () => {
    const page = asPage(readPullCursor({
      cursor: delta(0),
      retainedThroughSeq: 0,
      changes: [
        { seq: 0, entityType: 'ticket', clientEntityId: 'already', payload: { title: SECRET } },
        { seq: 1, entityType: 'ticket', clientEntityId: 'ticket-1', payload: { title: 'first' } },
      ],
    }));
    expect(page.instructions).toHaveLength(1);
    expect(page.instructions[0]).toMatchObject({ op: 'upsert', clientEntityId: 'ticket-1' });
    expect(JSON.stringify(page)).not.toContain(SECRET);
    expect(decodeSyncCursor(page.cursor)).toEqual({ v: 1, kind: 'delta', seq: 1 });
  });

  it('returns every change strictly after the cursor, in sequence order, and re-encodes with the codec', () => {
    const changes = [
      { seq: 5, entityType: 'ticket' as const, clientEntityId: 'c', payload: { title: 'third' } },
      { seq: 2, entityType: 'ticket' as const, clientEntityId: 'a', payload: { title: 'first' } },
      { seq: 4, entityType: 'ticket' as const, clientEntityId: 'b', payload: { title: 'second' } },
      { seq: 1, entityType: 'ticket' as const, clientEntityId: 'before', payload: { title: SECRET } },
    ];
    const snapshotRows = changes.map((row) => ({ ...row, payload: { ...row.payload } }));
    const page = asPage(readPullCursor({ cursor: delta(1), changes, retainedThroughSeq: 0 }));

    expect(page.instructions.map((instruction) => instruction.clientEntityId)).toEqual(['a', 'b', 'c']);
    expect(page.instructions.map((instruction) => instruction.seq)).toEqual([2, 4, 5]);
    expect(decodeSyncCursor(page.cursor)).toEqual({ v: 1, kind: 'delta', seq: 5 });
    expect(JSON.stringify(page)).not.toContain(SECRET);
    expect(changes).toEqual(snapshotRows);
  });

  it('maps a tombstone row to a local delete instruction and keeps no payload', () => {
    const page = asPage(readPullCursor<{ title: string }>({
      cursor: delta(1),
      retainedThroughSeq: 1,
      changes: [
        { seq: 2, entityType: 'ticket', clientEntityId: 'live', payload: { title: 'stays' } },
        {
          seq: 3,
          entityType: 'ticket',
          clientEntityId: 'dead',
          deletedAt: DELETED_AT,
          payload: { title: SECRET },
        },
        { seq: 4, entityType: 'ticket', clientEntityId: 'after', payload: { title: 'later' } },
      ],
    }));

    expect(page.instructions.map((instruction) => instruction.clientEntityId)).toEqual(['live', 'dead', 'after']);
    const deletion = asDelete(page.instructions[1] as { op: string });
    expect(deletion).toEqual({
      op: 'delete',
      clientEntityId: 'dead',
      entityType: 'ticket',
      deletedAt: DELETED_AT,
      seq: 3,
    });
    expect(deletion).not.toHaveProperty('record');
    expect(deletion).not.toHaveProperty('payload');
    expect(JSON.stringify(deletion)).not.toContain(SECRET);
    expect(page.deleted).toEqual(['dead']);
    expect((page.instructions[0] as LocalUpsertInstruction<{ title: string }>).record.payload).toEqual({ title: 'stays' });
  });

  it('maps a sync_changes delete operation to a delete even when deleted_at is blank', () => {
    const page = asPage(readPullCursor({
      cursor: delta(0),
      retainedThroughSeq: 0,
      changes: [{
        seq: 1,
        entityType: 'project',
        clientEntityId: 'project-1',
        operation: 'delete',
        deletedAt: null,
        payload: { title: SECRET },
      }],
    }));

    expect(page.instructions).toEqual([{
      op: 'delete',
      clientEntityId: 'project-1',
      entityType: 'project',
      seq: 1,
    }]);
    expect(JSON.stringify(page)).not.toContain(SECRET);
    expect(page.deleted).toEqual(['project-1']);
  });

  it('accepts a Date tombstone column and a nested record tombstone', () => {
    const byDate = asPage(readPullCursor({
      cursor: delta(0),
      retainedThroughSeq: 0,
      changes: [{ seq: 1, entityType: 'ticket', clientEntityId: 'by-date', deletedAt: new Date(DELETED_AT) }],
    }));
    expect(asDelete(byDate.instructions[0] as { op: string }).deletedAt).toBe(DELETED_AT);

    const byRecord = asPage(readPullCursor({
      cursor: delta(0),
      retainedThroughSeq: 0,
      changes: [{
        seq: 2,
        record: {
          id: 'by-record',
          entityType: 'ticket',
          schemaVersion: 1,
          version: 3,
          destination: { kind: 'unbound' },
          occurredAt: DELETED_AT,
          updatedAt: DELETED_AT,
          deletedAt: DELETED_AT,
          payload: { title: SECRET },
        },
      }],
    }));
    expect(asDelete(byRecord.instructions[0] as { op: string })).toMatchObject({
      op: 'delete',
      clientEntityId: 'by-record',
      entityType: 'ticket',
      deletedAt: DELETED_AT,
    });
    expect(JSON.stringify(byRecord)).not.toContain(SECRET);
  });

  it('does not treat a blank or missing deletedAt as a tombstone', () => {
    const page = asPage(readPullCursor<{ title: string }>({
      cursor: delta(1),
      retainedThroughSeq: 1,
      changes: [
        { seq: 2, entityType: 'ticket', clientEntityId: 'blank', deletedAt: '   ', payload: { title: 'live' } },
        { seq: 3, entityType: 'ticket', clientEntityId: 'nulled', deletedAt: null, payload: { title: 'also-live' } },
      ],
    }));

    expect(page.instructions.map((instruction) => instruction.op)).toEqual(['upsert', 'upsert']);
    expect(page.deleted).toEqual([]);
    expect((page.instructions[0] as LocalUpsertInstruction<{ title: string }>).record.payload).toEqual({ title: 'live' });
  });

  it('reads sync_records through a snapshot cursor and maps a tombstone, without leaking the delta log', () => {
    const cursor = snapshot('project', 'project-0');
    expect(decodeSyncCursor(cursor)?.kind).toBe('snapshot');
    const records = [
      { entityType: 'project' as const, clientEntityId: 'project-0', payload: { title: SECRET } },
      { entityType: 'ticket' as const, clientEntityId: 'ticket-9', payload: { title: 'live' } },
      {
        entityType: 'ticket' as const,
        clientEntityId: 'ticket-dead',
        deletedAt: new Date(DELETED_AT),
        payload: { title: SECRET },
      },
    ];
    const changes = [{ seq: 99, entityType: 'ticket' as const, clientEntityId: 'from-log', payload: { title: SECRET } }];
    const page = asPage(readPullCursor({ cursor, records, changes }));

    expect(page.instructions.map((instruction) => instruction.clientEntityId)).toEqual(['ticket-9', 'ticket-dead']);
    expect(asDelete(page.instructions[1] as { op: string })).toMatchObject({
      op: 'delete',
      clientEntityId: 'ticket-dead',
      deletedAt: DELETED_AT,
    });
    expect(page.deleted).toEqual(['ticket-dead']);
    expect(JSON.stringify(page)).not.toContain(SECRET);
    expect(JSON.stringify(page)).not.toContain('from-log');
    expect(decodeSyncCursor(page.cursor)).toEqual({
      v: 1,
      kind: 'snapshot',
      afterEntityType: 'ticket',
      afterClientEntityId: 'ticket-dead',
    });
    expect(records[2]?.payload).toEqual({ title: SECRET });
  });

  it('does not let a delta page read sync_records, so a projection cannot partially merge', () => {
    const page = asPage(readPullCursor({
      cursor: delta(1),
      retainedThroughSeq: 1,
      records: [{ entityType: 'ticket', clientEntityId: 'ticket-1', payload: { title: SECRET } }],
      changes: [{ seq: 2, entityType: 'ticket', clientEntityId: 'from-log', payload: { title: 'delta' } }],
    }));
    expect(page.instructions.map((instruction) => instruction.clientEntityId)).toEqual(['from-log']);
    expect(JSON.stringify(page)).not.toContain(SECRET);
  });

  it('allows a cursor equal to retainedThroughSeq and does not drop later rows', () => {
    const page = asPage(readPullCursor({
      cursor: delta(10),
      retainedThroughSeq: 10,
      changes: [
        { seq: 10, entityType: 'ticket', clientEntityId: 'boundary', payload: { title: SECRET } },
        { seq: 11, entityType: 'ticket', clientEntityId: 'next', payload: { title: 'due' } },
      ],
    }));
    expect(page.instructions.map((instruction) => instruction.clientEntityId)).toEqual(['next']);
    expect(decodeSyncCursor(page.cursor)).toEqual({ v: 1, kind: 'delta', seq: 11 });
  });

  it('re-encodes an empty window at the same cursor and does not mutate the input', () => {
    const changes = [{ seq: 2, entityType: 'ticket' as const, clientEntityId: 'old', payload: { title: SECRET } }];
    const page = asPage(readPullCursor({ cursor: delta(7), changes, retainedThroughSeq: 7 }));
    expect(page.instructions).toEqual([]);
    expect(page.deleted).toEqual([]);
    expect(page.cursor).toBe(delta(7));
    expect(decodeSyncCursor(page.cursor)).toEqual({ v: 1, kind: 'delta', seq: 7 });
    expect(changes).toEqual([{ seq: 2, entityType: 'ticket', clientEntityId: 'old', payload: { title: SECRET } }]);
  });

  it('copies upsert bodies so a caller cannot mutate a served row through the page', () => {
    const payload = { title: 'shared' };
    const changes = [{ seq: 2, entityType: 'ticket' as const, clientEntityId: 'ticket-2', payload }];
    const page = asPage(readPullCursor<{ title: string }>({ cursor: delta(1), changes, retainedThroughSeq: 1 }));
    const upsert = page.instructions[0] as LocalUpsertInstruction<{ title: string }>;
    expect(upsert.record.payload).toEqual({ title: 'shared' });
    expect(upsert.record.payload).not.toBe(payload);
    expect(upsert.record.destination).toEqual({ kind: 'unbound' });
    payload.title = 'mutated';
    expect(upsert.record.payload).toEqual({ title: 'shared' });
  });

  it('freezes the page and the resnapshot so neither can be rewritten into a partial merge', () => {
    const refused = readPullCursor({ cursor: '0', changes: leaked });
    expect(Object.isFrozen(refused)).toBe(true);
    const empty = asPage(readPullCursor({ cursor: delta(0), changes: [] }));
    expect(Object.isFrozen(empty)).toBe(true);
    expect(Object.isFrozen(empty.instructions)).toBe(true);
    expect(Object.isFrozen(empty.deleted)).toBe(true);
  });
});
