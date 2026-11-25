import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { boardSnapshotScheduler, writeBoardSnapshot } from './boardSnapshotWriter';

const reported = vi.hoisted(() => vi.fn());
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: reported }));

const SESSION = '22222222-2222-4222-8222-222222222222';
const OBJECT = '11111111-1111-4111-8111-111111111111';
const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;
const board = [{ revision: 6, viewport: { x: 0, y: 0, zoom: 1 } }];
const objectRow = { id: OBJECT, kind: 'note', resourceType: null, resourceId: null, resourceRevision: null, canvasData: { x: 1 }, content: { title: 'A' } };

describe('writeBoardSnapshot', () => {
  it('writes the committed graph at the board’s current revision, once, and refreshes the card face', async () => {
    const db = fakeDb([board, [objectRow], [], [], []]);
    await writeBoardSnapshot(asDb(db), 7, SESSION);
    const snapshot = db.calls.find((call) => call.kind === 'insert');
    expect(snapshot?.payload).toMatchObject({
      sessionId: SESSION, revision: 6, graph: { objects: [expect.objectContaining({ id: OBJECT, kind: 'note' })], connections: [] },
    });
    expect(snapshot?.chain).toContain('onConflictDoNothing');
    expect(db.calls.find((call) => call.kind === 'update')?.payload).toMatchObject({ preview: expect.objectContaining({ objectCount: 1 }) });
  });

  it('does nothing for a board that is not in the tenant', async () => {
    const db = fakeDb([[]]);
    await writeBoardSnapshot(asDb(db), 7, SESSION);
    expect(db.calls.map((call) => call.kind)).toEqual(['select']);
  });
});

describe('boardSnapshotScheduler', () => {
  it('collapses the effects of one chunk into ONE snapshot per board, and snapshots again for the next chunk', async () => {
    const db = fakeDb([board, [], [], [], [], board, [], [], [], []]);
    const schedule = boardSnapshotScheduler(asDb(db));
    await Promise.all([schedule(7, SESSION), schedule(7, SESSION), schedule(7, SESSION)].map((effect) => effect()));
    expect(db.calls.filter((call) => call.kind === 'insert')).toHaveLength(1);
    await schedule(7, SESSION)();
    expect(db.calls.filter((call) => call.kind === 'insert')).toHaveLength(2);
  });

  it('reports a failed snapshot instead of throwing (the edits are committed)', async () => {
    const db = fakeDb([new Error('neon unavailable')]);
    await expect(boardSnapshotScheduler(asDb(db))(7, SESSION)()).resolves.toBeUndefined();
    expect(reported).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'writeBoardSnapshot' }));
  });
});
