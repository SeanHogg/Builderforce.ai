import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import { ctx, dbOf, event, mapping, stores } from '../../sync/importers/__fixtures__/importerHarness';
import { importSyncedCanvasMedia } from './importSyncedCanvasMedia';

const seams = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../sessionAccess', async (original) => ({
  ...(await original<typeof import('../sessionAccess')>()),
  resolveSessionAccess: seams.resolve,
}));

const BOARD = '22222222-2222-4222-8222-222222222222';
const OBJECT = '33333333-3333-4333-8333-333333333333';
const MEDIA = '11111111-1111-4111-8111-111111111111';
const session = (role: string, status = 'active') => ({ role, session: { id: BOARD, tenantId: 7, status } });
const manifest = (extra: Record<string, unknown> = {}) => ({
  boardId: BOARD, objectId: OBJECT, mimeType: 'image/png', bytes: 2048, sha256: 'A'.repeat(64), name: 'logo.png', status: 'local', ...extra,
});
const normalised = (extra: Record<string, unknown> = {}) => ({ ...manifest(), sha256: 'a'.repeat(64), storageKey: null, ...extra });
const op = (operation: 'create' | 'update' | 'delete', body: unknown = manifest()) =>
  event({ entityType: 'canvas-media', operation, payload: body, baseVersion: operation === 'create' ? undefined : 1 });
const run = (e: ReturnType<typeof event>, found: ReturnType<typeof mapping> | null = null) =>
  importSyncedCanvasMedia(e, ctx(), stores(found), dbOf());
const mapped = (body: unknown) => mapping({ serverId: MEDIA, serverVersion: 1, payloadHash: hashSyncPayload(body) });

beforeEach(() => {
  seams.resolve.mockReset().mockResolvedValue(session('editor'));
});

describe('importSyncedCanvasMedia', () => {
  it('accepts a well-formed manifest as an editor — it writes no row, the push persists the mapping and projection', async () => {
    const dbCalls = dbOf();
    const outcome = await importSyncedCanvasMedia(op('create'), ctx(), stores(null), dbCalls);
    expect(outcome).toMatchObject({ status: 'applied', serverId: MEDIA, serverVersion: 1, payload: normalised() });
    expect(dbCalls.calls.filter((c) => c.kind === 'insert' || c.kind === 'update')).toEqual([]);
  });

  it('refuses a viewer, holds for a board that has not landed', async () => {
    seams.resolve.mockResolvedValue(session('viewer'));
    expect(await run(op('create'))).toEqual({ status: 'rejected', detail: 'canvas_board_forbidden' });
    seams.resolve.mockResolvedValue(null);
    expect(await run(op('create'))).toEqual({ status: 'pending', detail: 'canvas_board_pending' });
  });

  it('rejects malformed manifests', async () => {
    const bad = [
      manifest({ mimeType: 'not a mime' }),
      manifest({ bytes: -1 }),
      manifest({ bytes: 201 * 1024 * 1024 }),
      manifest({ sha256: 'xyz' }),
      manifest({ status: 'teleported' }),
      manifest({ name: '' }),
      manifest({ objectId: 'nope' }),
      manifest({ status: 'uploaded' }),
      manifest({ status: 'uploaded', storageKey: '../other-tenant/file' }),
    ];
    for (const body of bad) expect(await run(op('create', body))).toEqual({ status: 'rejected', detail: 'canvas_media_invalid' });
  });

  it('requires the storage key of an uploaded manifest and bumps the version on the upload transition', async () => {
    const uploaded = manifest({ status: 'uploaded', storageKey: 'tenants/7/boards/b/logo.png' });
    expect(await run(op('update', uploaded), mapped(normalised()))).toMatchObject({
      status: 'applied', serverVersion: 2, payload: expect.objectContaining({ status: 'uploaded', storageKey: 'tenants/7/boards/b/logo.png' }),
    });
  });

  it('answers a replay from its mapping, and a different manifest under the same id as a conflict', async () => {
    expect(await run(op('create'), mapped(normalised()))).toMatchObject({ status: 'applied', serverVersion: 1 });
    expect(await run(op('create', manifest({ bytes: 5 })), mapped(normalised()))).toMatchObject({ status: 'conflict' });
  });

  it('deletes a manifest only when it names a board the caller may write', async () => {
    expect(await run(op('delete', { boardId: BOARD }), mapped(normalised()))).toMatchObject({ status: 'applied', serverVersion: 2 });
    expect(await run(op('delete', null), mapped(normalised()))).toEqual({ status: 'rejected', detail: 'canvas_media_invalid' });
    seams.resolve.mockResolvedValue(session('viewer'));
    expect(await run(op('delete', { boardId: BOARD }), mapped(normalised()))).toEqual({ status: 'rejected', detail: 'canvas_board_forbidden' });
  });
});
