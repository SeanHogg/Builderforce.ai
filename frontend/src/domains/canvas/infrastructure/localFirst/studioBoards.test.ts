// @vitest-environment jsdom
/** The Studio's boards on this device: created locally FIRST (no server, no `local-` fallback), listed from the replica. */
import { indexedDB } from 'fake-indexeddb';
import { UNBOUND_DESTINATION, type EntityDestination } from '@builderforce/local-first';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT, openTestBlobs, openTestStore, sticky, testContext, uuid } from './boardTestkit';

const world = vi.hoisted(() => ({ runtime: undefined as unknown, destination: { kind: 'unbound' } as EntityDestination }));

vi.mock('@/lib/localFirst/studioRuntime', () => ({ getStudioRuntime: async () => world.runtime }));
vi.mock('@/lib/auth', () => ({
  getStoredTenant: () => (world.destination.kind === 'bound' ? { id: 'tenant-1' } : null),
  getStoredTenantToken: () => (world.destination.kind === 'bound' ? 'token' : null),
  AUTH_API_URL: 'https://api.example.com',
}));

// The verbs are reached through their one door, which hands the module its ports.
const studio = await import('@/lib/pendingWork');
const { readBoard } = await import('./boardReplica');

const open: Array<{ close(): void }> = [];

function boot(): ReturnType<typeof testContext>['store'] {
  const db = `studio-${uuid()}`;
  const store = openTestStore(indexedDB, db);
  const blobs = openTestBlobs(indexedDB, `${db}-blobs`);
  open.push(store, blobs);
  world.runtime = { store, ctx: testContext(store), blobs, deviceId: 'device-a', driver: { trigger: vi.fn() } };
  return store;
}

beforeEach(() => { world.destination = UNBOUND_DESTINATION; localStorage.clear(); });
afterEach(() => { for (const handle of open.splice(0)) handle.close(); });

describe('createLocalCreationSession', () => {
  it('hands back an id at once and has written the board by the time it is awaited', async () => {
    const store = boot();
    const id = studio.createLocalCreationSession('A habit tracker');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id.startsWith('local-')).toBe(false);

    await studio.awaitBoardCreated(id);
    const replica = (await readBoard(store, id))!;
    expect(replica.header.payload).toMatchObject({ title: 'A habit tracker', initialPrompt: 'A habit tracker' });
    expect(replica.timeline.map((message) => message.body)).toEqual(['A habit tracker']);
    expect(replica.board.nodes.map((node) => node.data.kind)).toEqual(['chat']);
  });

  it('files a guest board unbound and a signed-in person\'s board under the workspace, with no server call', async () => {
    const store = boot();
    const guest = studio.createLocalCreationSession('guest');
    await studio.awaitBoardCreated(guest);
    expect((await readBoard(store, guest))!.destination).toEqual(UNBOUND_DESTINATION);
    expect(await store.read((tx) => tx.pending())).toEqual([]);

    world.destination = ACCOUNT;
    const mine = studio.createLocalCreationSession('mine');
    await studio.awaitBoardCreated(mine);
    expect((await readBoard(store, mine))!.destination).toMatchObject({ kind: 'bound', tenantId: ACCOUNT.tenantId });
    // Journaled in the same transaction: the board, its Brain card and the opening message are owed to the server.
    expect((await store.read((tx) => tx.pending())).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the device\'s board lists', () => {
  it('separates the boards sign-in can bind from the workspace\'s own', async () => {
    boot();
    const guest = studio.createLocalCreationSession('guest');
    world.destination = ACCOUNT;
    const mine = studio.createLocalCreationSession('mine');

    expect((await studio.listLocalCreationSessions()).map((entry) => entry.sessionId)).toEqual([guest]);
    expect((await studio.listWorkspaceBoards()).map((entry) => entry.sessionId)).toEqual([mine]);
  });

  it('renames and files a board through its header, and removes it with its checkpoints', async () => {
    boot();
    const id = studio.createLocalCreationSession('draft');
    await studio.updateLocalCreationSession(id, { title: '  Roadmap  ', folder: 'Plans' });
    expect(await studio.listLocalCreationSessions()).toMatchObject([{ sessionId: id, title: 'Roadmap', folder: 'Plans' }]);

    localStorage.setItem(`builderforce:create:${id}:checkpoints`, '{}');
    await studio.removeLocalCreationSession(id);
    expect(localStorage.getItem(`builderforce:create:${id}:checkpoints`)).toBeNull();
    expect(await studio.listLocalCreationSessions()).toEqual([]);
  });

  it('folds source boards into the target and removes them', async () => {
    boot();
    const target = studio.createLocalCreationSession('target');
    const source = studio.createLocalCreationSession('source');
    const merged = await studio.mergeLocalCreationSessions(target, [source]);
    expect(merged?.nodes.length).toBe(2);
    expect((await studio.listLocalCreationSessions()).map((entry) => entry.sessionId)).toEqual([target]);
    expect((await studio.readLocalCreationSession(target))?.nodes.length).toBe(2);
  });

  it('creates a board the device does not hold on its first write, and the edits after it survive a reload', async () => {
    // A room joiner, a failed create, an old link whose import failed: the canvas opens with no replica.
    const store = boot();
    const id = uuid();
    const first = sticky(uuid(), 0);
    await studio.writeLocalCreationSession(id, { title: 'Joined', nodes: [first], edges: [], timeline: [] });
    await studio.writeLocalCreationSession(id, { nodes: [first, sticky(uuid(), 200)], edges: [], timeline: [] });

    // "Reload": nothing in memory but the store.
    const reloaded = (await readBoard(store, id))!;
    expect(reloaded.header.payload.title).toBe('Joined');
    expect(reloaded.board.nodes).toHaveLength(2);
  });
});
