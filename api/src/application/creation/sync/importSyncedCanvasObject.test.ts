import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import { boundKey, ctx, dbOf, event, mapping, stores } from '../../sync/importers/__fixtures__/importerHarness';
import type { CanvasSyncPorts } from './canvasSyncPorts';
import { importSyncedCanvasObject } from './importSyncedCanvasObject';

const seams = vi.hoisted(() => ({
  resolve: vi.fn(), edit: vi.fn(), resource: vi.fn(), onBoard: vi.fn(), boardOf: vi.fn(), count: vi.fn(),
}));
vi.mock('../sessionAccess', async (original) => ({
  ...(await original<typeof import('../sessionAccess')>()),
  resolveSessionAccess: seams.resolve,
}));
vi.mock('../boardEditWriter', () => ({ applyBoardEdit: seams.edit }));
vi.mock('../resourceAccess', () => ({ validateResourceAccess: seams.resource }));
vi.mock('./canvasGraphReads', () => ({
  objectsOnBoard: seams.onBoard, boardOfObject: seams.boardOf, countBoardObjects: seams.count,
}));

const BOARD = '22222222-2222-4222-8222-222222222222';
const CARD = '11111111-1111-4111-8111-111111111111';
const scheduled: string[] = [];
const ports: CanvasSyncPorts = {
  sessionQuota: async () => ({ used: 0, limit: -1, allowed: true, currentPlan: 'free' as never }),
  scheduleSnapshot: (_tenantId, sessionId) => async () => { scheduled.push(sessionId); },
};
const session = (role: string, status = 'active') => ({ role, session: { id: BOARD, tenantId: 7, status, segmentId: 'seg-1' } });
const payload = (extra: Record<string, unknown> = {}) => ({ boardId: BOARD, kind: 'note', canvasData: { x: 1, y: 2 }, content: { title: 'Hi' }, ...extra });
const op = (operation: 'create' | 'update' | 'delete', body: unknown = payload()) =>
  event({ entityType: 'canvas-object', operation, payload: body, baseVersion: operation === 'create' ? undefined : 2 });
const mapped = (body: unknown) => mapping({ serverId: CARD, serverVersion: 2, payloadHash: hashSyncPayload(body) });

function run(e: ReturnType<typeof event>, found: ReturnType<typeof mapping> | null = null, effects: Array<() => Promise<unknown>> = []) {
  return importSyncedCanvasObject(e, ctx({ afterCommit: (effect) => { effects.push(effect); } }), stores(found), dbOf(), ports);
}

beforeEach(() => {
  scheduled.length = 0;
  seams.resolve.mockReset().mockResolvedValue(session('editor'));
  seams.edit.mockReset().mockResolvedValue({ status: 'applied', revision: 5 });
  seams.resource.mockReset().mockResolvedValue(null);
  seams.onBoard.mockReset().mockResolvedValue(new Set());
  seams.boardOf.mockReset().mockResolvedValue(BOARD);
  seams.count.mockReset().mockResolvedValue(0);
});

describe('importSyncedCanvasObject', () => {
  it('creates the object through the per-edit writer and schedules ONE deferred snapshot', async () => {
    const effects: Array<() => Promise<unknown>> = [];
    const outcome = await run(op('create'), null, effects);
    expect(outcome).toMatchObject({ status: 'applied', serverId: CARD, serverVersion: 1, destinationKey: boundKey });
    expect(seams.edit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionId: BOARD, eventType: 'object.created', eventObjectId: CARD, idempotencyKey: 'sync:evt-1',
    }));
    expect(effects).toHaveLength(1);
    await effects[0]!();
    expect(scheduled).toEqual([BOARD]);
  });

  it('holds the event when its board has not landed (nothing the caller can see, nothing in their tenant)', async () => {
    seams.resolve.mockResolvedValue(null);
    expect(await run(op('create'))).toEqual({ status: 'pending', detail: 'canvas_board_pending' });
    expect(seams.edit).not.toHaveBeenCalled();
  });

  it('refuses a viewer and a commenter', async () => {
    for (const role of ['viewer', 'commenter']) {
      seams.resolve.mockResolvedValue(session(role));
      expect(await run(op('create'))).toEqual({ status: 'rejected', detail: 'canvas_board_forbidden' });
    }
    expect(seams.edit).not.toHaveBeenCalled();
  });

  it('refuses a write to a deleted board', async () => {
    seams.resolve.mockResolvedValue(session('owner', 'deleted'));
    expect(await run(op('create'))).toEqual({ status: 'rejected', detail: 'canvas_board_deleted' });
  });

  it('refuses a card whose resource the caller may not place, and an unknown kind', async () => {
    seams.resource.mockResolvedValue('A Project is unavailable or belongs to another workspace');
    expect(await run(op('create', payload({ resourceType: 'project', resourceId: '9' })))).toEqual({ status: 'rejected', detail: 'canvas_resource_denied' });
    expect(await run(op('create', payload({ kind: 'not-a-kind' })))).toEqual({ status: 'rejected', detail: 'canvas_object_invalid' });
  });

  it('refuses an id that is already ANOTHER board’s object (the writer returns no row)', async () => {
    seams.edit.mockImplementation(async (_tx, edit: { refuse: (r: unknown[]) => string | null }) => ({ status: 'refused', code: edit.refuse([[]]) }));
    expect(await run(op('create'))).toEqual({ status: 'rejected', detail: 'canvas_object_invalid' });
  });

  it('refuses the 1,001st object with a hold code', async () => {
    seams.count.mockResolvedValue(1_000);
    expect(await run(op('create'))).toEqual({ status: 'rejected', detail: 'canvas_object_limit' });
  });

  it('answers a replay from its mapping and a different payload under the same id as a conflict', async () => {
    const same = {
      boardId: BOARD, kind: 'note', resourceType: null, resourceId: null, resourceRevision: null,
      canvasData: { x: 1, y: 2 }, content: { title: 'Hi' },
    };
    expect(await run(op('create'), mapped(same))).toMatchObject({ status: 'applied', serverVersion: 2 });
    expect(await run(op('create', payload({ content: { title: 'Else' } })), mapped(same))).toMatchObject({ status: 'conflict' });
    expect(seams.edit).not.toHaveBeenCalled();
  });

  it('updates an existing object, bumping the mapping version', async () => {
    seams.onBoard.mockResolvedValue(new Set([CARD]));
    expect(await run(op('update', payload({ content: { title: 'New' } })), mapped(payload()))).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(seams.edit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'object.updated' }));
  });

  it('answers an update of an object a collaborator deleted as a conflict, never a silent re-insert', async () => {
    expect(await run(op('update', payload({ content: { title: 'New' } })), mapped(payload()))).toMatchObject({
      status: 'conflict', detail: 'canvas_object_deleted_remotely',
    });
    expect(seams.edit).not.toHaveBeenCalled();
  });

  it('deletes a payload-less tombstone by finding the board the object is on', async () => {
    const effects: Array<() => Promise<unknown>> = [];
    expect(await run(op('delete', null), mapped(payload()), effects)).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(seams.boardOf).toHaveBeenCalledWith(expect.anything(), 7, CARD);
    expect(seams.edit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'object.deleted' }));
    expect(effects).toHaveLength(1);
  });

  it('acknowledges a delete of an object that is already gone, without writing', async () => {
    seams.boardOf.mockResolvedValue(null);
    expect(await run(op('delete', null), mapped(payload()))).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(seams.edit).not.toHaveBeenCalled();
  });

  it('writes nothing for a replayed event key', async () => {
    seams.edit.mockResolvedValue({ status: 'replayed', revision: 5 });
    const effects: Array<() => Promise<unknown>> = [];
    expect(await run(op('create'), null, effects)).toMatchObject({ status: 'applied', serverVersion: 1 });
    expect(effects).toEqual([]);
  });
});
