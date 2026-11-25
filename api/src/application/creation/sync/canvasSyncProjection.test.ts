import { describe, expect, it } from 'vitest';
import { destinationKey } from '@builderforce/local-first';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import {
  boardPayload,
  canvasProjectionScope,
  desiredBoardRecords,
  edgePayload,
  objectPayload,
  planCanvasProjection,
  touchedBoardIds,
  writeCanvasProjection,
  type DesiredCanvasRecord,
  type ProjectedCanvasRecord,
} from './canvasSyncProjection';

const BOARD = '11111111-1111-4111-8111-111111111111';
const OBJECT = '22222222-2222-4222-8222-222222222222';
const OBJECT_2 = '33333333-3333-4333-8333-333333333333';
const EDGE = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-25T10:00:00Z');
const SCOPE = canvasProjectionScope(7);
const KEY = destinationKey(SCOPE.destination);

const session = { id: BOARD, title: 'Plan', mode: 'chat', status: 'active', updatedAt: NOW };
const objectRow = (id: string, content: unknown = { text: 'hi' }) => ({
  id, sessionId: BOARD, kind: 'note', resourceType: null, resourceId: null, resourceRevision: null,
  canvasData: { x: 1, y: 2 }, content, searchText: '', createdBy: null, updatedBy: null, lockedBy: null,
  lockExpiresAt: null, createdAt: NOW, updatedAt: NOW, nextDueAt: null,
});
const edgeRow = { id: EDGE, sessionId: BOARD, sourceObjectId: OBJECT, targetObjectId: OBJECT_2, kind: 'reference', label: null, metadata: null, createdBy: null, createdAt: NOW };

const stored = (record: DesiredCanvasRecord, over: Partial<ProjectedCanvasRecord> = {}): ProjectedCanvasRecord => ({
  entityType: record.entityType, clientEntityId: record.clientEntityId, version: 3, destinationKey: KEY,
  payloadHash: hashSyncPayload(record.payload), payload: record.payload, deletedAt: null, ...over,
});

describe('payload mappers', () => {
  it('produce the canonical shapes the push importers store', () => {
    expect(boardPayload(session)).toEqual({ title: 'Plan', mode: 'chat' });
    expect(Object.keys(objectPayload(objectRow(OBJECT) as never))).toEqual(
      ['boardId', 'kind', 'resourceType', 'resourceId', 'resourceRevision', 'canvasData', 'content'],
    );
    expect(edgePayload(edgeRow as never)).toEqual({ boardId: BOARD, source: OBJECT, target: OBJECT_2, kind: 'reference', label: null, metadata: null });
  });
});

describe('planCanvasProjection', () => {
  const desired = desiredBoardRecords(session, [objectRow(OBJECT) as never], [edgeRow as never]);

  it('creates every record of a board that was never projected', () => {
    const plan = planCanvasProjection(desired, [], KEY, NOW);
    expect(plan.map((c) => [c.entityType, c.operation, c.version])).toEqual([
      ['canvas-board', 'create', 1], ['canvas-object', 'create', 1], ['canvas-edge', 'create', 1],
    ]);
  });

  it('writes nothing when every record already matches (a pushed row is not projected twice)', () => {
    expect(planCanvasProjection(desired, desired.map((d) => stored(d)), KEY, NOW)).toEqual([]);
  });

  it('bumps the version of a record whose row changed', () => {
    const existing = desired.map((d) => stored(d, d.entityType === 'canvas-object' ? { payloadHash: 'fnv1a:00000000' } : {}));
    const plan = planCanvasProjection(desired, existing, KEY, NOW);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ entityType: 'canvas-object', clientEntityId: OBJECT, operation: 'update', version: 4 });
  });

  it('tombstones a record whose row is gone, keeping its last payload', () => {
    const gone = { entityType: 'canvas-object', clientEntityId: OBJECT_2, version: 2, destinationKey: KEY, payloadHash: 'h', payload: { boardId: BOARD }, deletedAt: null } as ProjectedCanvasRecord;
    const plan = planCanvasProjection(desired, [...desired.map((d) => stored(d)), gone], KEY, NOW);
    expect(plan).toEqual([expect.objectContaining({ clientEntityId: OBJECT_2, operation: 'delete', deleted: true, version: 3, payload: { boardId: BOARD } })]);
  });

  it('tombstones the board and every child when the board is deleted', () => {
    const live = desiredBoardRecords(session, [objectRow(OBJECT) as never], [edgeRow as never]);
    const plan = planCanvasProjection(desiredBoardRecords({ ...session, status: 'deleted' }, [], []), live.map((d) => stored(d)), KEY, NOW);
    expect(plan.map((c) => [c.entityType, c.operation]).sort()).toEqual([['canvas-board', 'delete'], ['canvas-edge', 'delete'], ['canvas-object', 'delete']]);
  });

  it('leaves a record that belongs to another destination alone', () => {
    const other = desired.map((d) => stored(d, { destinationKey: 'elsewhere', payloadHash: 'stale' }));
    expect(planCanvasProjection(desired, other, KEY, NOW)).toEqual([]);
  });
});

describe('writeCanvasProjection', () => {
  function recordingDb() {
    const inserts: Array<{ rows: unknown[] }> = [];
    const tx = {
      insert: () => ({
        values: (rows: unknown[]) => {
          const entry = { rows };
          inserts.push(entry);
          const done = Promise.resolve([]);
          return Object.assign(done, { onConflictDoUpdate: () => done });
        },
      }),
    };
    return { inserts, db: { transaction: (work: (t: unknown) => Promise<unknown>) => work(tx) } as never };
  }

  it('is exactly two multi-row inserts for any number of changes', async () => {
    const { db, inserts } = recordingDb();
    const changes = planCanvasProjection(desiredBoardRecords(session, [objectRow(OBJECT) as never, objectRow(OBJECT_2) as never], [edgeRow as never]), [], KEY, NOW);
    await writeCanvasProjection(db, SCOPE, changes, NOW);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.rows).toHaveLength(changes.length);
    expect(inserts[1]!.rows).toHaveLength(changes.length);
  });

  it('writes a tombstone change row carrying deletedAt', async () => {
    const { db, inserts } = recordingDb();
    await writeCanvasProjection(db, SCOPE, [{ entityType: 'canvas-object', clientEntityId: OBJECT, payload: { boardId: BOARD }, occurredAt: NOW, deleted: true, operation: 'delete', version: 2 }], NOW);
    const change = inserts[1]!.rows[0] as { operation: string; record: { deletedAt?: string } };
    expect(change.operation).toBe('delete');
    expect(change.record.deletedAt).toBe(NOW.toISOString());
  });

  it('writes nothing for an empty plan', async () => {
    const { db, inserts } = recordingDb();
    await writeCanvasProjection(db, SCOPE, [], NOW);
    expect(inserts).toHaveLength(0);
  });
});

describe('touchedBoardIds', () => {
  it('reads the board from the path and from a creating route\'s answer', () => {
    expect(touchedBoardIds(`/api/creation-sessions/${BOARD}/graph`, null)).toEqual([BOARD]);
    expect(touchedBoardIds('/api/creation-sessions', { id: OBJECT })).toEqual([OBJECT]);
    expect(touchedBoardIds('/api/creation-sessions/claim', { session: { id: BOARD }, sessionId: BOARD })).toEqual([BOARD]);
  });

  it('ignores anything that is not a UUID', () => {
    expect(touchedBoardIds('/api/creation-sessions/templates', { id: 'x', sessionId: 5 })).toEqual([]);
  });
});
