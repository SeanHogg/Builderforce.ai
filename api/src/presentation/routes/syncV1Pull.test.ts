/**
 * Presentation — /api/sync/v1/pull handler tests (G18, ticket #5852).
 *
 * Covers the adapter contract only: `handleSyncV1Pull` returns `queryPull`'s
 * result unchanged. The cursor semantics themselves are covered in
 * application/sync/pullDelta.test.ts; these tests assert the route layer adds
 * no translation, no fallback, and no mutation.
 */

import { describe, expect, it } from 'vitest';
import { queryPull } from '../../application/sync/pullDelta';
import { encodeSyncCursor } from '../../domain/sync/syncProtocol';
import { handleSyncV1Pull } from './syncV1Pull';

const deltaCursor = (seq: number): string => encodeSyncCursor({ v: 1, kind: 'delta', seq });

describe('handleSyncV1Pull — returns queryPull unchanged', () => {
  it('returns the delta page for a usable cursor', () => {
    const result = handleSyncV1Pull({
      cursor: deltaCursor(10),
      changes: [
        { seq: 12, clientEntityId: 'c1', body: { title: 'twelve' } },
        { seq: 11, clientEntityId: 'c2', body: { title: 'eleven' } },
      ],
    });

    expect('changes' in result && 'cursor' in result).toBe(true);
    if (!('changes' in result)) throw new Error('expected a delta page');
    // Sequence order, not input order.
    expect(result.changes.map((change) => change.seq)).toEqual([11, 12]);
    expect(typeof result.cursor).toBe('string');
    expect(result.cursor).not.toBe('');
  });

  it('equals queryPull for the same input — no translation layer', () => {
    const input = {
      cursor: deltaCursor(4),
      changes: [
        { seq: 6, clientEntityId: 'a', body: { n: 1 } },
        { seq: 5, clientEntityId: 'b', deletedAt: '2026-01-01T00:00:00.000Z' },
      ],
    };

    expect(handleSyncV1Pull(input)).toEqual(queryPull(input));
  });

  it('returns the same resnapshot object queryPull returns', () => {
    const input = { cursor: null, changes: [{ seq: 1, body: { leak: true } }] };
    expect(handleSyncV1Pull(input)).toBe(queryPull(input));
  });

  it('preserves the tombstone delete without a body', () => {
    const deletedAt = '2026-02-02T00:00:00.000Z';
    const result = handleSyncV1Pull({
      cursor: deltaCursor(1),
      changes: [{ seq: 2, clientEntityId: 'gone', body: { secret: true }, deletedAt }],
    });

    if (!('changes' in result)) throw new Error('expected a delta page');
    expect(result.changes[0]).toEqual({ seq: 2, clientEntityId: 'gone', deletedAt, op: 'delete' });
    expect(result.changes[0]).not.toHaveProperty('body');
    expect(result.changes[0]).not.toHaveProperty('payload');
  });

  it('resnapshots for a null cursor, with nothing else in the result', () => {
    const result = handleSyncV1Pull({ cursor: null, changes: [{ seq: 1, clientEntityId: 'x', body: {} }] });
    expect(result).toEqual({ resnapshotRequired: true });
    expect('changes' in result).toBe(false);
    expect('cursor' in result).toBe(false);
  });

  it('resnapshots for a blank cursor', () => {
    expect(handleSyncV1Pull({ cursor: '   ', changes: [] })).toEqual({ resnapshotRequired: true });
  });

  it('resnapshots for a cursor this codec did not produce', () => {
    expect(handleSyncV1Pull({ cursor: 'not-a-real-cursor', changes: [{ seq: 9, body: {} }] })).toEqual({
      resnapshotRequired: true,
    });
  });

  it('resnapshots for a non-delta cursor', () => {
    const snapshot = encodeSyncCursor({
      v: 1,
      kind: 'snapshot',
      afterEntityType: 'ticket',
      afterClientEntityId: 'ticket-0',
    });
    expect(handleSyncV1Pull({ cursor: snapshot, changes: [{ seq: 4, body: {} }] })).toEqual({
      resnapshotRequired: true,
    });
  });

  it('resnapshots when the delta seq is older than retainedThroughSeq', () => {
    const result = handleSyncV1Pull({
      cursor: deltaCursor(5),
      retainedThroughSeq: 9,
      changes: [{ seq: 10, body: {} }],
    });
    // A gap in the retained log, never sequence 0.
    expect(result).toEqual({ resnapshotRequired: true });
  });

  it('resnapshots for null and undefined input without throwing', () => {
    expect(handleSyncV1Pull(null)).toEqual({ resnapshotRequired: true });
    expect(handleSyncV1Pull(undefined)).toEqual({ resnapshotRequired: true });
  });

  it('does not mutate the caller input', () => {
    const changes = [{ seq: 3, clientEntityId: 'k', body: { v: 1 } }];
    const input = { cursor: deltaCursor(1), changes };
    handleSyncV1Pull(input);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ seq: 3, clientEntityId: 'k', body: { v: 1 } });
  });
});