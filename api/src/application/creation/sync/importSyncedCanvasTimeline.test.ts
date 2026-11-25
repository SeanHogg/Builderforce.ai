import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import { ctx, dbOf, event, mapping, stores } from '../../sync/importers/__fixtures__/importerHarness';
import { importSyncedCanvasTimeline } from './importSyncedCanvasTimeline';

const seams = vi.hoisted(() => ({ resolve: vi.fn(), append: vi.fn(), name: vi.fn() }));
vi.mock('../sessionAccess', async (original) => ({
  ...(await original<typeof import('../sessionAccess')>()),
  resolveSessionAccess: seams.resolve,
}));
vi.mock('../timelineWriter', () => ({ appendTimelineMessage: seams.append }));
vi.mock('./canvasGraphReads', () => ({ displayNameOf: seams.name }));

const BOARD = '22222222-2222-4222-8222-222222222222';
const session = (role: string, status = 'active') => ({ role, session: { id: BOARD, tenantId: 7, status } });
const payload = (extra: Record<string, unknown> = {}) => ({
  boardId: BOARD, clientMessageId: 'm-1', role: 'user', body: ' hello ', metadata: { scope: 'board', evil: 'x' },
  createdAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const op = (operation: 'create' | 'update' | 'delete', body: unknown = payload()) =>
  event({ entityType: 'canvas-timeline', operation, payload: body, baseVersion: operation === 'create' ? undefined : 1 });
const run = (e: ReturnType<typeof event>, found: ReturnType<typeof mapping> | null = null) =>
  importSyncedCanvasTimeline(e, ctx(), stores(found), dbOf());

beforeEach(() => {
  seams.resolve.mockReset().mockResolvedValue(session('editor'));
  seams.append.mockReset().mockResolvedValue({ message: { id: 31 }, inserted: true });
  seams.name.mockReset().mockResolvedValue('Ann');
});

describe('importSyncedCanvasTimeline', () => {
  it('appends the message through the transcript writer, attributed to the caller, metadata whitelisted', async () => {
    expect(await run(op('create'))).toMatchObject({ status: 'applied', serverId: '31', serverVersion: 1 });
    expect(seams.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionId: BOARD, clientMessageId: 'm-1', role: 'user', body: 'hello', createdBy: 'user-1',
      metadata: { scope: 'board', authoredBy: { kind: 'human', ref: 'user-1', name: 'Ann' } },
    }));
  });

  it('adopts a message the HTTP route already wrote (same client message id) instead of duplicating', async () => {
    seams.append.mockResolvedValue({ message: { id: 9 }, inserted: false });
    expect(await run(op('create'))).toMatchObject({ status: 'applied', serverId: '9' });
  });

  it('is append-only: update and delete are refused', async () => {
    expect(await run(op('update'))).toEqual({ status: 'rejected', detail: 'canvas_timeline_immutable' });
    expect(await run(op('delete', null))).toEqual({ status: 'rejected', detail: 'canvas_timeline_immutable' });
    expect(seams.append).not.toHaveBeenCalled();
  });

  it('holds until the board exists; refuses a viewer', async () => {
    seams.resolve.mockResolvedValue(null);
    expect(await run(op('create'))).toEqual({ status: 'pending', detail: 'canvas_board_pending' });
    seams.resolve.mockResolvedValue(session('viewer'));
    expect(await run(op('create'))).toEqual({ status: 'rejected', detail: 'canvas_board_forbidden' });
    expect(seams.append).not.toHaveBeenCalled();
  });

  it('rejects an empty body, a missing message id and a missing board', async () => {
    for (const body of [payload({ body: '   ' }), payload({ clientMessageId: '' }), payload({ boardId: 'x' })]) {
      expect(await run(op('create', body))).toEqual({ status: 'rejected', detail: 'canvas_timeline_invalid' });
    }
  });

  it('answers a replay from its mapping, and a different body under the same id as a conflict', async () => {
    const same = { boardId: BOARD, clientMessageId: 'm-1', role: 'user', body: 'hello' };
    const mapped = mapping({ serverId: '31', payloadHash: hashSyncPayload(same) });
    expect(await run(op('create'), mapped)).toMatchObject({ status: 'applied', serverId: '31' });
    expect(await run(op('create', payload({ body: 'else' })), mapped)).toMatchObject({ status: 'conflict' });
    expect(seams.append).not.toHaveBeenCalled();
  });
});
