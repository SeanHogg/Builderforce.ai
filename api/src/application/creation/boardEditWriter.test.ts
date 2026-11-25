import { describe, expect, it } from 'vitest';
import { dbOf } from '../sync/importers/__fixtures__/importerHarness';
import { applyBoardEdit, type BoardEdit } from './boardEditWriter';
import { objectUpsertStatement } from './creationGraphWriter';

const SESSION = '22222222-2222-4222-8222-222222222222';
const OBJECT = '11111111-1111-4111-8111-111111111111';

const edit = (extra: Partial<BoardEdit> = {}): BoardEdit => ({
  sessionId: SESSION,
  tenantId: 7,
  authorUserId: 'user-1',
  eventType: 'object.created',
  eventObjectId: OBJECT,
  eventPayload: { objectId: OBJECT },
  idempotencyKey: 'sync:evt-1',
  content: (db) => [objectUpsertStatement(db, SESSION, { id: OBJECT, kind: 'note', canvasData: { x: 1 }, content: { title: 'A' } }, 'user-1')],
  ...extra,
});

describe('applyBoardEdit', () => {
  it('locks the board, writes the edit at the NEXT revision, then the revision bump and the keyed event', async () => {
    const tx = dbOf([[{ revision: 4 }], [], [{ id: OBJECT }], [], []]);
    expect(await applyBoardEdit(tx, edit())).toEqual({ status: 'applied', revision: 5 });
    expect(tx.calls[0]?.chain).toContain('for');
    const bump = tx.calls.find((call) => call.kind === 'update');
    expect(bump?.payload).toMatchObject({ canvasRevision: 5, updatedBy: 'user-1' });
    const event = tx.calls.filter((call) => call.kind === 'insert').at(-1);
    expect(event?.payload).toMatchObject({
      sessionId: SESSION, revision: 5, eventType: 'object.created', objectId: OBJECT, idempotencyKey: 'sync:evt-1',
    });
    expect(tx.savepoints()).toBe(1);
  });

  it('sets only what the edit names on the session (a rename leaves the viewport alone)', async () => {
    const tx = dbOf([[{ revision: 1 }], [], [], []]);
    await applyBoardEdit(tx, edit({ content: () => [], sessionSet: { title: 'New' }, eventObjectId: undefined }));
    const bump = tx.calls.find((call) => call.kind === 'update');
    expect(bump?.payload).toMatchObject({ canvasRevision: 2, title: 'New' });
    expect(bump?.payload).not.toHaveProperty('viewport');
  });

  it('writes nothing when the idempotency key is already on the board', async () => {
    const tx = dbOf([[{ revision: 4 }], [{ revision: 5 }]]);
    expect(await applyBoardEdit(tx, edit())).toEqual({ status: 'replayed', revision: 5 });
    expect(tx.calls.map((call) => call.kind)).toEqual(['select', 'select']);
  });

  it('reports a board that is not in the tenant', async () => {
    expect(await applyBoardEdit(dbOf([[]]), edit())).toEqual({ status: 'missing' });
  });

  it('rolls the edit back, before any revision bump, when the content says it is not this board’s', async () => {
    const tx = dbOf([[{ revision: 4 }], [], []]);
    const result = await applyBoardEdit(tx, edit({ refuse: () => 'canvas_object_invalid' }));
    expect(result).toEqual({ status: 'refused', code: 'canvas_object_invalid' });
    expect(tx.calls.some((call) => call.kind === 'update')).toBe(false);
  });

  it('lets a real failure through, so the push chunk rolls back', async () => {
    const tx = dbOf([[{ revision: 4 }], [], new Error('connection reset')]);
    await expect(applyBoardEdit(tx, edit())).rejects.toThrow('connection reset');
  });
});
