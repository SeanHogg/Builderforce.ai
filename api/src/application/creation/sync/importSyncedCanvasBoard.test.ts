import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appliedNew } from '../../sync/importers';
import { boundKey, ctx, dbOf, event, mapping, stores } from '../../sync/importers/__fixtures__/importerHarness';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import type { CanvasSyncPorts } from './canvasSyncPorts';
import { importSyncedCanvasBoard } from './importSyncedCanvasBoard';

const access = vi.hoisted(() => ({ resolve: vi.fn(), edit: vi.fn() }));
vi.mock('../sessionAccess', async (original) => ({
  ...(await original<typeof import('../sessionAccess')>()),
  resolveSessionAccess: access.resolve,
}));
vi.mock('../boardEditWriter', () => ({ applyBoardEdit: access.edit }));

const BOARD = '11111111-1111-4111-8111-111111111111';
const auth = { tenantId: 7, userId: 'user-1', role: 'member', segmentId: 'seg-1' };
const allowed = { used: 0, limit: -1, allowed: true, currentPlan: 'free' as never };
const ports = (quota = allowed): CanvasSyncPorts => ({
  sessionQuota: async () => quota,
  scheduleSnapshot: () => async () => undefined,
});
const session = (role: string, status = 'active') => ({ role, session: { id: BOARD, tenantId: 7, status, title: 'Old', mode: 'chat', segmentId: 'seg-1' } });
const create = (payload: unknown = { title: 'Roadmap', mode: 'work' }) => event({ entityType: 'canvas-board', operation: 'create', payload });
const run = (e: ReturnType<typeof event>, opts: { mapping?: ReturnType<typeof mapping> | null; quota?: typeof allowed; tx?: ReturnType<typeof dbOf>; c?: ReturnType<typeof ctx> } = {}) =>
  importSyncedCanvasBoard(e, opts.c ?? ctx({ auth }), stores(opts.mapping ?? null), opts.tx ?? dbOf(), ports(opts.quota));

beforeEach(() => {
  access.resolve.mockReset().mockResolvedValue(null);
  access.edit.mockReset().mockResolvedValue({ status: 'applied', revision: 4 });
});

describe('importSyncedCanvasBoard — create', () => {
  it('creates the board under the client uuid, as one transaction of session, owner seat, event and snapshot', async () => {
    const tx = dbOf();
    const outcome = await run(create(), { tx });
    expect(outcome).toMatchObject({ status: 'applied', serverId: BOARD, serverVersion: 1, destinationKey: boundKey });
    expect(tx.savepoints()).toBe(1);
    expect(tx.calls.filter((c) => c.kind === 'insert').length).toBeGreaterThanOrEqual(4);
  });

  it('refuses a board over the plan cap with the plan code, and writes nothing', async () => {
    const tx = dbOf();
    const outcome = await run(create(), { tx, quota: { used: 3, limit: 3, allowed: false, currentPlan: 'free' as never } });
    expect(outcome).toEqual({ status: 'rejected', detail: 'CREATION_SESSION_QUOTA' });
    expect(tx.calls.filter((c) => c.kind === 'insert')).toEqual([]);
  });

  it('cannot create without the caller’s workspace segment (a hold)', async () => {
    expect(await run(create(), { c: ctx() })).toEqual({ status: 'rejected', detail: 'canvas_segment_unavailable' });
  });

  it('rejects an id that is not a creation uuid and a title that is empty', async () => {
    expect(await run({ ...create(), clientEntityId: 'not-a-uuid' })).toEqual({ status: 'rejected', detail: 'canvas_board_id_invalid' });
    expect(await run(create({ title: '  ' }))).toEqual({ status: 'rejected', detail: 'canvas_board_title_invalid' });
    expect(await run(create({ title: 'ok', mode: 'sideways' }))).toEqual({ status: 'rejected', detail: 'payload_invalid' });
  });

  it('adopts the caller’s own existing board instead of duplicating it', async () => {
    access.resolve.mockResolvedValue(session('owner'));
    const tx = dbOf();
    const outcome = await run(create(), { tx });
    expect(outcome).toMatchObject({ status: 'applied', serverId: BOARD, serverVersion: 1, payload: { title: 'Old', mode: 'chat' } });
    expect(tx.calls.filter((c) => c.kind === 'insert')).toEqual([]);
  });

  it('answers a replay from its mapping, and a different payload under the same id as a conflict', async () => {
    const same = { title: 'Roadmap', mode: 'work' };
    const mapped = mapping({ serverId: BOARD, serverVersion: 1, payloadHash: hashSyncPayload(same) });
    expect(await run(create(), { mapping: mapped })).toMatchObject({ status: 'applied', serverId: BOARD });
    expect(await run(create({ title: 'Other', mode: 'work' }), { mapping: mapped })).toMatchObject({ status: 'conflict', detail: 'entity_already_imported' });
  });

  it('turns a lost id race on a board that is not the caller’s into a refusal', async () => {
    const tx = dbOf([new Error('duplicate key value violates unique constraint "creation_sessions_pkey"')]);
    const outcome = await run(create(), { tx });
    expect(outcome).toEqual({ status: 'rejected', detail: 'canvas_board_id_conflict' });
  });
});

describe('importSyncedCanvasBoard — update and delete', () => {
  const mapped = mapping({ serverId: BOARD, serverVersion: 2, payloadHash: hashSyncPayload({ title: 'Old', mode: 'chat' }) });
  const update = (payload: unknown = { title: 'New', mode: 'chat' }) => event({ entityType: 'canvas-board', operation: 'update', payload, baseVersion: 2 });
  const remove = () => event({ entityType: 'canvas-board', operation: 'delete', payload: null, baseVersion: 2 });

  it('renames through the per-edit writer as an editor, bumping the mapping version', async () => {
    access.resolve.mockResolvedValue(session('editor'));
    const outcome = await run(update(), { mapping: mapped });
    expect(outcome).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(access.edit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionId: BOARD, eventType: 'session.updated', sessionSet: { title: 'New', mode: 'chat' },
    }));
  });

  it('refuses a viewer’s rename with the forbidden code', async () => {
    access.resolve.mockResolvedValue(session('viewer'));
    expect(await run(update(), { mapping: mapped })).toEqual({ status: 'rejected', detail: 'canvas_board_forbidden' });
    expect(access.edit).not.toHaveBeenCalled();
  });

  it('answers a stale base version as a conflict', async () => {
    access.resolve.mockResolvedValue(session('owner'));
    const stale = event({ entityType: 'canvas-board', operation: 'update', payload: { title: 'New' }, baseVersion: 1 });
    expect(await run(stale, { mapping: mapped })).toMatchObject({ status: 'conflict', detail: 'base_version_conflict' });
  });

  it('deletes (soft, recoverable) only as an owner', async () => {
    access.resolve.mockResolvedValue(session('editor'));
    expect(await run(remove(), { mapping: mapped })).toEqual({ status: 'rejected', detail: 'canvas_board_forbidden' });
    access.resolve.mockResolvedValue(session('owner'));
    expect(await run(remove(), { mapping: mapped })).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(access.edit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'session.deleted', sessionSet: expect.objectContaining({ status: 'deleted' }),
    }));
  });

  it('acknowledges a delete of a board that is already deleted without writing', async () => {
    access.resolve.mockResolvedValue(session('owner', 'deleted'));
    expect(await run(remove(), { mapping: mapped })).toEqual(appliedNew(BOARD, 3, boundKey, { status: 'deleted' }));
    expect(access.edit).not.toHaveBeenCalled();
  });

  it('treats a lost revision race as a hold, not a refusal that dead-letters', async () => {
    access.resolve.mockResolvedValue(session('owner'));
    access.edit.mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint "uq_creation_events_revision"'), { code: '23505' }));
    expect(await run(update(), { mapping: mapped })).toEqual({ status: 'rejected', detail: 'canvas_write_failed' });
  });
});
