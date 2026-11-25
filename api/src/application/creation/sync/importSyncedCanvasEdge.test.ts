import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import { ctx, dbOf, event, mapping, stores } from '../../sync/importers/__fixtures__/importerHarness';
import type { CanvasSyncPorts } from './canvasSyncPorts';
import { importSyncedCanvasEdge } from './importSyncedCanvasEdge';

const seams = vi.hoisted(() => ({ resolve: vi.fn(), edit: vi.fn(), onBoard: vi.fn(), boardOf: vi.fn(), count: vi.fn() }));
vi.mock('../sessionAccess', async (original) => ({
  ...(await original<typeof import('../sessionAccess')>()),
  resolveSessionAccess: seams.resolve,
}));
vi.mock('../boardEditWriter', () => ({ applyBoardEdit: seams.edit }));
vi.mock('./canvasGraphReads', () => ({
  objectsOnBoard: seams.onBoard, boardOfConnection: seams.boardOf, countBoardConnections: seams.count,
}));

const BOARD = '22222222-2222-4222-8222-222222222222';
const EDGE = '11111111-1111-4111-8111-111111111111';
const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';
const ports: CanvasSyncPorts = {
  sessionQuota: async () => ({ used: 0, limit: -1, allowed: true, currentPlan: 'free' as never }),
  scheduleSnapshot: () => async () => undefined,
};
const session = (role: string, status = 'active') => ({ role, session: { id: BOARD, tenantId: 7, status, segmentId: 'seg-1' } });
const payload = (extra: Record<string, unknown> = {}) => ({ boardId: BOARD, source: A, target: B, kind: 'reference', data: { label: 'blocks' }, ...extra });
const op = (operation: 'create' | 'update' | 'delete', body: unknown = payload()) =>
  event({ entityType: 'canvas-edge', operation, payload: body, baseVersion: operation === 'create' ? undefined : 2 });
const run = (e: ReturnType<typeof event>, found: ReturnType<typeof mapping> | null = null) =>
  importSyncedCanvasEdge(e, ctx(), stores(found), dbOf(), ports);
const mapped = (body: unknown) => mapping({ serverId: EDGE, serverVersion: 2, payloadHash: hashSyncPayload(body) });

beforeEach(() => {
  seams.resolve.mockReset().mockResolvedValue(session('editor'));
  seams.edit.mockReset().mockResolvedValue({ status: 'applied', revision: 5 });
  seams.onBoard.mockReset().mockResolvedValue(new Set([A, B]));
  seams.boardOf.mockReset().mockResolvedValue(BOARD);
  seams.count.mockReset().mockResolvedValue(0);
});

describe('importSyncedCanvasEdge', () => {
  it('creates the connection through the per-edit writer', async () => {
    expect(await run(op('create'))).toMatchObject({ status: 'applied', serverId: EDGE, serverVersion: 1 });
    expect(seams.edit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionId: BOARD, eventType: 'connection.created', idempotencyKey: 'sync:evt-1',
    }));
  });

  it('holds the edge until both endpoint objects are on the board', async () => {
    seams.onBoard.mockResolvedValue(new Set([A]));
    expect(await run(op('create'))).toEqual({ status: 'pending', detail: 'canvas_edge_endpoint_pending' });
    expect(seams.edit).not.toHaveBeenCalled();
  });

  it('holds the edge until its board exists, and refuses a viewer', async () => {
    seams.resolve.mockResolvedValue(null);
    expect(await run(op('create'))).toEqual({ status: 'pending', detail: 'canvas_board_pending' });
    seams.resolve.mockResolvedValue(session('viewer'));
    expect(await run(op('create'))).toEqual({ status: 'rejected', detail: 'canvas_board_forbidden' });
  });

  it('rejects a malformed edge: bad endpoint id, unknown kind, non-object data', async () => {
    for (const body of [payload({ source: 'nope' }), payload({ kind: 'telepathy' }), payload({ data: 'x' }), payload({ data: { label: 7 } })]) {
      expect(await run(op('create', body))).toEqual({ status: 'rejected', detail: 'canvas_edge_invalid' });
    }
  });

  it('refuses the 4,001st connection with a hold code', async () => {
    seams.count.mockResolvedValue(4_000);
    expect(await run(op('create'))).toEqual({ status: 'rejected', detail: 'canvas_edge_limit' });
  });

  it('answers a replay from its mapping and a different payload as a conflict', async () => {
    const same = { boardId: BOARD, source: A, target: B, kind: 'reference', label: 'blocks', metadata: null };
    expect(await run(op('create'), mapped(same))).toMatchObject({ status: 'applied', serverVersion: 2 });
    expect(await run(op('create', payload({ data: { label: 'else' } })), mapped(same))).toMatchObject({ status: 'conflict' });
  });

  it('updates an edge (bumping the version) and deletes a payload-less tombstone by its board', async () => {
    expect(await run(op('update', payload({ data: { label: 'new' } })), mapped(payload()))).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(await run(op('delete', null), mapped(payload()))).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(seams.boardOf).toHaveBeenCalledWith(expect.anything(), 7, EDGE);
    expect(seams.edit).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ eventType: 'connection.deleted' }));
  });

  it('acknowledges a delete of an edge that is already gone (its object was deleted)', async () => {
    seams.boardOf.mockResolvedValue(null);
    expect(await run(op('delete', null), mapped(payload()))).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(seams.edit).not.toHaveBeenCalled();
  });
});
