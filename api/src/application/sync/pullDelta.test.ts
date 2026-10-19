import { describe, expect, it } from 'vitest';
import { decodeSyncCursor, encodeSyncCursor } from '../../domain/sync/cursorCodec';
import { queryPull, type PullDeltaPage, type PullDeltaRow, type QueryPullResult } from './pullDelta';

const DELETED_AT = '2026-10-19T12:00:00.000Z';

function delta(seq: number): string {
  return encodeSyncCursor({ v: 1, kind: 'delta', seq });
}

function row(
  partial: PullDeltaRow<{ title: string }> & { note?: string },
): PullDeltaRow<{ title: string }> & { note?: string } {
  return { ...partial };
}

function asPage(result: QueryPullResult<{ title: string }>): PullDeltaPage<{ title: string }> {
  expect(result).not.toHaveProperty('resnapshotRequired');
  if ('resnapshotRequired' in result) throw new Error('expected a delta page');
  return result;
}

function expectResnapshot(result: QueryPullResult<unknown>, secret?: string): void {
  expect(result).toEqual({ resnapshotRequired: true });
  expect(Object.keys(result)).toEqual(['resnapshotRequired']);
  expect(result).not.toHaveProperty('changes');
  expect(result).not.toHaveProperty('cursor');
  expect(result).not.toHaveProperty('records');
  expect(result).not.toHaveProperty('seq');
  const encoded = JSON.stringify(result);
  expect(encoded).not.toContain('0');
  if (secret !== undefined) expect(encoded).not.toContain(secret);
}

describe('queryPull', () => {
  it('resnapshots a null cursor and does not return the supplied rows', () => {
    const changes = [row({ seq: 1, clientEntityId: 'ticket-1', body: { title: 'secret' } })];
    const result = queryPull({ cursor: null, changes, retainedThroughSeq: 0 });

    expectResnapshot(result, 'secret');
    expect(changes).toEqual([{ seq: 1, clientEntityId: 'ticket-1', body: { title: 'secret' } }]);
  });

  it('resnapshots a blank cursor instead of treating it as sequence 0', () => {
    const changes = [row({ seq: 1, clientEntityId: 'ticket-1', body: { title: 'kept' } })];
    for (const cursor of ['', '   ', '\n\t']) {
      const result = queryPull({ cursor, changes, retainedThroughSeq: 0 });
      expectResnapshot(result, 'kept');
      expect(result).not.toHaveProperty('seq');
    }
    expect(changes).toHaveLength(1);
  });

  it('resnapshots when decodeSyncCursor returns null and does not start at sequence 0', () => {
    const changes = [
      row({ seq: 1, clientEntityId: 'ticket-1', body: { title: 'nope' } }),
      row({ seq: 2, clientEntityId: 'ticket-2', body: { title: 'also-nope' } }),
    ];
    for (const cursor of ['0', 'not-a-cursor', 'bfc1.0.deadbeef']) {
      const result = queryPull({ cursor, changes, retainedThroughSeq: 0 });
      expectResnapshot(result, 'nope');
      expect(JSON.stringify(result)).not.toContain('ticket-1');
      expect(JSON.stringify(result)).not.toContain('also-nope');
    }
    expect(decodeSyncCursor('0')).toBeNull();
    expect(changes.map((change) => change.seq)).toEqual([1, 2]);
  });

  it('resnapshots a snapshot cursor instead of reading it as a delta seq', () => {
    const changes = [row({ seq: 1, clientEntityId: 'ticket-1', body: { title: 'snapshot-leak' } })];
    const cursor = encodeSyncCursor({
      v: 1,
      kind: 'snapshot',
      afterEntityType: 'ticket',
      afterClientEntityId: 'ticket-0',
    });

    const result = queryPull({ cursor, changes, retainedThroughSeq: 0 });

    expect(decodeSyncCursor(cursor)?.kind).toBe('snapshot');
    expectResnapshot(result, 'snapshot-leak');
  });

  it('resnapshots a delta seq older than retainedThroughSeq and returns no partial rows', () => {
    const changes = [
      row({ seq: 9, clientEntityId: 'swept', body: { title: 'gone' } }),
      row({ seq: 10, clientEntityId: 'kept-in-log', body: { title: 'must-not-leak' } }),
      row({ seq: 11, clientEntityId: 'later', body: { title: 'also-hidden' } }),
    ];
    const result = queryPull({ cursor: delta(9), changes, retainedThroughSeq: 10 });

    expectResnapshot(result, 'must-not-leak');
    expect(JSON.stringify(result)).not.toContain('also-hidden');
    expect(JSON.stringify(result)).not.toContain('gone');
    expect(changes).toHaveLength(3);
    expect(changes[1]?.body).toEqual({ title: 'must-not-leak' });
  });

  it('does not treat a missing retention bound as sequence 0', () => {
    const changes = [row({ seq: 4, clientEntityId: 'ticket-4', body: { title: 'after' } })];
    const page = asPage(queryPull({ cursor: delta(3), changes, retainedThroughSeq: null }));

    expect(page.changes.map((change) => change.seq)).toEqual([4]);
    expect(page.cursor).toBe(delta(4));
  });

  it('serves a real sequence 0 cursor without confusing it with a bad cursor', () => {
    const changes = [
      row({ seq: 0, clientEntityId: 'already', body: { title: 'seen' } }),
      row({ seq: 1, clientEntityId: 'ticket-1', body: { title: 'first' } }),
    ];
    const page = asPage(queryPull({ cursor: delta(0), changes, retainedThroughSeq: 0 }));

    expect(page.changes).toEqual([{ seq: 1, clientEntityId: 'ticket-1', body: { title: 'first' } }]);
    expect(page.cursor).toBe(encodeSyncCursor({ v: 1, kind: 'delta', seq: 1 }));
    expect(decodeSyncCursor(page.cursor)).toEqual({ v: 1, kind: 'delta', seq: 1 });
  });

  it('returns every row after the cursor in sequence order, including gaps', () => {
    const changes = [
      row({ seq: 5, clientEntityId: 'c', body: { title: 'third' }, note: 'keep' }),
      row({ seq: 2, clientEntityId: 'a', body: { title: 'first' } }),
      row({ seq: 2, clientEntityId: 'a-again', body: { title: 'same-seq' } }),
      row({ seq: 4, clientEntityId: 'b', body: { title: 'second' } }),
      row({ seq: 1, clientEntityId: 'before', body: { title: 'excluded' } }),
    ];
    const snapshot = changes.map((change) => ({ ...change, body: change.body ? { ...change.body } : change.body }));
    const page = asPage(queryPull({ cursor: delta(1), changes, retainedThroughSeq: 0 }));

    expect(page.changes.map((change) => change.seq)).toEqual([2, 2, 4, 5]);
    expect(page.changes.map((change) => change.clientEntityId)).toEqual(['a', 'a-again', 'b', 'c']);
    expect(page.changes[3]).toMatchObject({ note: 'keep', body: { title: 'third' } });
    expect(page.cursor).toBe(delta(5));
    expect(JSON.stringify(page)).not.toContain('excluded');
    expect(changes).toEqual(snapshot);
  });

  it('includes a tombstone as a delete and does not keep its body', () => {
    const changes = [
      row({ seq: 2, clientEntityId: 'live', body: { title: 'stays' } }),
      row({
        seq: 3,
        clientEntityId: 'dead',
        deletedAt: DELETED_AT,
        body: { title: 'secret-body' },
        payload: { title: 'secret-payload' },
      }),
      row({ seq: 4, clientEntityId: 'after-delete', body: { title: 'still-here' } }),
    ];
    const page = asPage(queryPull({ cursor: delta(1), changes, retainedThroughSeq: 1 }));

    expect(page.changes).toHaveLength(3);
    expect(page.changes[1]).toEqual({
      seq: 3,
      clientEntityId: 'dead',
      deletedAt: DELETED_AT,
      op: 'delete',
    });
    expect(page.changes[1]).not.toHaveProperty('body');
    expect(page.changes[1]).not.toHaveProperty('payload');
    expect(JSON.stringify(page.changes[1])).not.toContain('secret-body');
    expect(JSON.stringify(page.changes[1])).not.toContain('secret-payload');
    expect(page.changes[2]).toMatchObject({ clientEntityId: 'after-delete', body: { title: 'still-here' } });
    expect(page.cursor).toBe(delta(4));
    expect(changes[1]?.body).toEqual({ title: 'secret-body' });
    expect(changes[1]?.payload).toEqual({ title: 'secret-payload' });
  });

  it('does not treat a blank deletedAt as a tombstone', () => {
    const changes = [
      row({ seq: 2, clientEntityId: 'blank', deletedAt: '   ', body: { title: 'live' } }),
      row({ seq: 3, clientEntityId: 'missing', deletedAt: null, body: { title: 'also-live' } }),
    ];
    const page = asPage(queryPull({ cursor: delta(1), changes, retainedThroughSeq: 0 }));

    expect(page.changes[0]).toMatchObject({ clientEntityId: 'blank', body: { title: 'live' } });
    expect(page.changes[0]).not.toHaveProperty('op');
    expect(page.changes[1]).toMatchObject({ body: { title: 'also-live' } });
  });

  it('re-encodes an empty window at the same seq and does not mutate the input', () => {
    const changes = [row({ seq: 2, clientEntityId: 'old', body: { title: 'before-cursor' } })];
    const page = asPage(queryPull({ cursor: delta(7), changes, retainedThroughSeq: 7 }));

    expect(page.changes).toEqual([]);
    expect(page.cursor).toBe(delta(7));
    expect(decodeSyncCursor(page.cursor)).toEqual({ v: 1, kind: 'delta', seq: 7 });
    expect(changes).toEqual([{ seq: 2, clientEntityId: 'old', body: { title: 'before-cursor' } }]);
  });

  it('allows a cursor equal to retainedThroughSeq and does not drop later rows', () => {
    const changes = [
      row({ seq: 10, clientEntityId: 'boundary', body: { title: 'seen' } }),
      row({ seq: 11, clientEntityId: 'next', body: { title: 'due' } }),
      row({ seq: 13, clientEntityId: 'gap', body: { title: 'kept' } }),
    ];
    const page = asPage(queryPull({ cursor: delta(10), changes, retainedThroughSeq: 10 }));

    expect(page.changes.map((change) => change.clientEntityId)).toEqual(['next', 'gap']);
    expect(page.cursor).toBe(delta(13));
  });
});
