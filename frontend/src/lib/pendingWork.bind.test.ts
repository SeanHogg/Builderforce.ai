// @vitest-environment jsdom
/** Design §7: signing in BINDS a board built before sign-in — one transaction, then the driver sends it; never an HTTP claim. */
import { indexedDB } from 'fake-indexeddb';
import { UNBOUND_DESTINATION, type EntityDestination } from '@builderforce/local-first';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard } from '@/domains/canvas/infrastructure/localFirst/boardCommit';
import { readBoard } from '@/domains/canvas/infrastructure/localFirst/boardReplica';
import { ACCOUNT, boardOf, openTestBlobs, openTestStore, sticky, testContext, uuid } from '@/domains/canvas/infrastructure/localFirst/boardTestkit';

const world = vi.hoisted(() => ({
  runtime: undefined as unknown,
  destination: { kind: 'unbound' } as EntityDestination,
  claim: vi.fn(),
}));

vi.mock('@/lib/brain', () => ({ NEW_CHAT_MODE: 'chat', normalizeChatMode: (mode: unknown) => (mode === 'work' ? 'work' : 'chat') }));
vi.mock('@/lib/builderforceApi', () => ({ creationSessionsApi: { claim: world.claim, list: vi.fn() } }));
vi.mock('@/lib/auth', () => ({
  getStoredTenant: () => (world.destination.kind === 'bound' ? { id: 'tenant-1' } : null),
  getStoredTenantToken: () => (world.destination.kind === 'bound' ? 'token' : null),
  AUTH_API_URL: 'https://api.example.com',
}));
vi.mock('@/lib/localFirst/studioRuntime', () => ({ getStudioRuntime: async () => world.runtime }));

const { bindLocalBoard, claimPendingDrafts } = await import('./pendingWork');

const open: Array<{ close(): void }> = [];
let trigger: ReturnType<typeof vi.fn>;

async function guestBoard(title = 'Guest') {
  const db = `pending-${uuid()}`;
  const store = openTestStore(indexedDB, db);
  const blobs = openTestBlobs(indexedDB, `${db}-blobs`);
  open.push(store, blobs);
  const ctx = testContext(store);
  trigger = vi.fn();
  world.runtime = { store, ctx, blobs, deviceId: 'device-a', driver: { trigger } };
  const boardId = uuid();
  await createBoard(ctx, { boardId, destination: UNBOUND_DESTINATION, header: { title }, board: boardOf([sticky(uuid(), 0)]) });
  return { store, boardId };
}

beforeEach(() => { world.destination = UNBOUND_DESTINATION; world.claim.mockReset(); });
afterEach(() => { for (const handle of open.splice(0)) handle.close(); });

describe('bindLocalBoard', () => {
  it('binds the board to the workspace in the store and asks the driver to send it — no HTTP claim', async () => {
    const { store, boardId } = await guestBoard('My board');
    world.destination = ACCOUNT;

    const claimed = await bindLocalBoard(boardId);

    expect(claimed).toEqual({ localSessionId: boardId, sessionId: boardId, title: 'My board' });
    expect(world.claim).not.toHaveBeenCalled();
    expect(trigger).toHaveBeenCalledTimes(1);
    expect((await readBoard(store, boardId))!.destination).toMatchObject({ kind: 'bound', tenantId: ACCOUNT.tenantId });
    expect((await store.read((tx) => tx.pending())).length).toBeGreaterThan(0);
  });

  it('is a no-op the second time: a retry after a crash cannot enqueue the board twice', async () => {
    const { store, boardId } = await guestBoard();
    world.destination = ACCOUNT;
    await bindLocalBoard(boardId);
    const owed = (await store.read((tx) => tx.pending())).length;

    await expect(bindLocalBoard(boardId)).resolves.toBeNull();
    expect((await store.read((tx) => tx.pending())).length).toBe(owed);
  });

  it('does nothing without a workspace: the board stays unbound on the device', async () => {
    const { store, boardId } = await guestBoard();
    await expect(bindLocalBoard(boardId)).resolves.toBeNull();
    expect((await readBoard(store, boardId))!.destination).toEqual(UNBOUND_DESTINATION);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('resolves null for a board the device does not hold', async () => {
    await guestBoard();
    world.destination = ACCOUNT;
    await expect(bindLocalBoard(uuid())).resolves.toBeNull();
  });
});

describe('claimPendingDrafts', () => {
  it('binds every board the device holds unbound and reports them, newest first', async () => {
    const { store, boardId } = await guestBoard('First');
    world.destination = ACCOUNT;
    // The list verb reads the same runtime; here it is the one board.
    const result = await claimPendingDrafts();
    expect(result.failed).toBe(0);
    expect(result.claimed.map((draft) => draft.sessionId)).toEqual([boardId]);
    expect((await readBoard(store, boardId))!.destination).toMatchObject({ kind: 'bound', tenantId: ACCOUNT.tenantId });
  });
});
