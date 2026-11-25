/**
 * The per-edit statement builders extracted from `creationGraphWriter` — and proof that the
 * whole-graph path still writes the same bookkeeping through the SAME builder.
 */

import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import {
  connectionDeleteStatement,
  connectionInsertRow,
  connectionUpsertStatement,
  creationGraphStatements,
  objectDeleteStatements,
  objectInsertRow,
  objectUpsertStatement,
  revisionBookkeepingStatements,
} from './creationGraphWriter';

const SESSION = '22222222-2222-4222-8222-222222222222';
const A = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;

describe('per-edit builders', () => {
  it('maps one object to its row once, bounded the way the whole-graph insert bounds it', () => {
    const row = objectInsertRow(SESSION, { id: A, kind: 'note', resourceType: 'p'.repeat(80), content: { title: 'Hi' } }, 'user-1');
    expect(row).toMatchObject({ id: A, sessionId: SESSION, kind: 'note', searchText: 'Hi', createdBy: 'user-1', updatedBy: 'user-1' });
    expect(row.resourceType).toHaveLength(64);
    expect(connectionInsertRow(SESSION, { id: B, sourceObjectId: A, targetObjectId: A }, null)).toMatchObject({ kind: 'reference', createdBy: null });
  });

  it('upserts an object scoped to its own session', () => {
    const db = fakeDb();
    objectUpsertStatement(asDb(db), SESSION, { id: A, kind: 'note' }, 'user-1');
    expect(db.calls[0]?.kind).toBe('insert');
    expect(db.calls[0]?.chain).toEqual(['values', 'onConflictDoUpdate', 'returning']);
  });

  it('deletes one object and drops the comment pins on objects the board no longer carries', () => {
    const db = fakeDb();
    const statements = objectDeleteStatements(asDb(db), 7, SESSION, A, new Date());
    expect(statements).toHaveLength(2);
    expect(db.calls.map((call) => call.kind)).toEqual(['delete', 'update']);
  });

  it('adds and removes one connection', () => {
    const db = fakeDb();
    connectionUpsertStatement(asDb(db), SESSION, { id: B, sourceObjectId: A, targetObjectId: A, label: 'x' }, 'user-1');
    connectionDeleteStatement(asDb(db), SESSION, B);
    expect(db.calls.map((call) => call.kind)).toEqual(['insert', 'delete']);
  });
});

describe('revisionBookkeepingStatements', () => {
  const write = {
    sessionId: SESSION, tenantId: 7, revision: 9, actorType: 'user' as const, actorRef: 'user-1', authorUserId: 'user-1',
    eventType: 'x.y', eventPayload: { a: 1 }, idempotencyKey: 'k', now: new Date(),
  };

  it('moves the session, then appends the keyed event', () => {
    const db = fakeDb();
    const statements = revisionBookkeepingStatements(asDb(db), { ...write, sessionSet: { title: 'T' } });
    expect(statements).toHaveLength(2);
    expect(db.calls[0]).toMatchObject({ kind: 'update', payload: expect.objectContaining({ canvasRevision: 9, title: 'T' }) });
    expect(db.calls[1]).toMatchObject({ kind: 'insert', payload: expect.objectContaining({ revision: 9, eventType: 'x.y', idempotencyKey: 'k' }) });
  });

  it('is the whole-graph write’s own tail: same revision, viewport and preview, event, then snapshot', () => {
    const db = fakeDb();
    creationGraphStatements(asDb(db), {
      sessionId: SESSION, tenantId: 7, objects: [{ id: A, kind: 'note' }], connections: [], revision: 3,
      actorType: 'user', actorRef: 'user-1', authorUserId: 'user-1', eventType: 'graph.replaced', eventPayload: {},
      idempotencyKey: 'k', viewport: { x: 1, y: 1, zoom: 1 },
    });
    expect(db.calls.map((call) => call.kind)).toEqual(['delete', 'delete', 'update', 'insert', 'update', 'insert', 'insert']);
    const bump = db.calls[4];
    expect(bump?.payload).toMatchObject({ canvasRevision: 3, viewport: { x: 1, y: 1, zoom: 1 }, preview: expect.objectContaining({ objectCount: 1 }) });
    expect(db.calls[5]?.payload).toMatchObject({ revision: 3, eventType: 'graph.replaced', idempotencyKey: 'k' });
  });
});
