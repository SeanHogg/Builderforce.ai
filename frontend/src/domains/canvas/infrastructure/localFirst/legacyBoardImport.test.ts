// @vitest-environment jsdom
/** Design §9 item 7: the legacy `builderforce:create:local-*` import is idempotent and never loses a board. */
import { indexedDB } from 'fake-indexeddb';
import { UNBOUND_DESTINATION } from '@builderforce/local-first';
import { afterEach, describe, expect, it } from 'vitest';
import { importLegacyBoards, type LegacyImportOptions } from './legacyBoardImport';
import { listBoards, readBoard } from './boardReplica';
import { AT, openTestBlobs, openTestStore, uuid } from './boardTestkit';

const open: Array<{ close(): void }> = [];
afterEach(() => { for (const handle of open.splice(0)) handle.close(); });

const PREFIX = 'builderforce:create:';

function fakeStorage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    storage: {
      get length() { return data.size; },
      key: (index: number) => [...data.keys()][index] ?? null,
      getItem: (key: string) => data.get(key) ?? null,
    },
    removeKey: (key: string) => { data.delete(key); },
  };
}

function legacyBoard(title: string): { id: string; raw: string; imageNodeId: string } {
  const [a, b, image] = [uuid(), uuid(), uuid()];
  const raw = JSON.stringify({
    version: 1, title, updatedAt: AT,
    nodes: [
      { id: a, type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'sticky', title: 'A' } },
      { id: b, type: 'creation', position: { x: 200, y: 0 }, data: { kind: 'sticky', title: 'B' } },
      { id: image, type: 'creation', position: { x: 0, y: 200 }, data: { kind: 'image', title: 'P', url: 'data:image/png;base64,AQIDBA==' } },
    ],
    edges: [{ id: 'edge-1', source: a, target: b }],
    timeline: [{ clientMessageId: 'm1', role: 'user', body: 'hi', createdAt: AT }],
  });
  return { id: `local-${uuid()}`, raw, imageNodeId: image };
}

function setup() {
  const db = `legacy-${uuid()}`;
  const store = openTestStore(indexedDB, db);
  const blobs = openTestBlobs(indexedDB, `${db}-blobs`);
  open.push(store, blobs);
  return { store, blobs };
}

const base = (store: LegacyImportOptions['store'], blobs: LegacyImportOptions['blobs']): Omit<LegacyImportOptions, 'storage' | 'removeKey'> =>
  ({ store, blobs, deviceId: 'device-a', destination: UNBOUND_DESTINATION, report: () => undefined });

describe('legacy board import', () => {
  it('imports N boards once: run twice, N boards, no data URLs, keys removed after commit', async () => {
    const { store, blobs } = setup();
    const boards = [legacyBoard('One'), legacyBoard('Two')];
    const entries = Object.fromEntries(boards.map((board) => [`${PREFIX}${board.id}`, board.raw]));
    const fake = fakeStorage({ ...entries, [`${PREFIX}${boards[0]!.id}:checkpoints`]: '[]', [`${PREFIX}index`]: '[]' });
    const options = { ...base(store, blobs), storage: fake.storage, removeKey: fake.removeKey };

    const first = await importLegacyBoards(options);
    expect(first.imported.sort()).toEqual(boards.map((board) => board.id).sort());
    expect(first.failed).toEqual([]);
    // Board keys are gone; the sidecar and the index are not boards and stay.
    expect([...fake.data.keys()].sort()).toEqual([`${PREFIX}${boards[0]!.id}:checkpoints`, `${PREFIX}index`].sort());

    // A crash before removal leaves the keys behind: the re-run skips them and cleans up.
    for (const board of boards) fake.data.set(`${PREFIX}${board.id}`, board.raw);
    const second = await importLegacyBoards(options);
    expect(second.imported).toEqual([]);
    expect(second.skipped.sort()).toEqual(boards.map((board) => board.id).sort());
    expect(await listBoards(store)).toHaveLength(2);

    const replica = (await readBoard(store, boards[0]!.id.slice('local-'.length)))!;
    expect(replica.board.nodes).toHaveLength(3);
    expect(replica.board.edges).toHaveLength(1);
    expect(replica.timeline).toHaveLength(1);
    expect(replica.media).toHaveLength(1);
    const image = replica.board.nodes.find((node) => node.id === boards[0]!.imageNodeId)!.data;
    expect(image.url).toBe(`media:${replica.media[0]!.id}`);
    expect((await (await blobs.get(replica.media[0]!.id))!.arrayBuffer()).byteLength).toBe(4);
    expect(JSON.stringify(await store.export())).not.toContain('data:image');
    expect(await store.read((tx) => tx.pending())).toEqual([]);
  });

  it('reports a failure and leaves the legacy key in place', async () => {
    const { store, blobs } = setup();
    const board = legacyBoard('Fails');
    const fake = fakeStorage({ [`${PREFIX}${board.id}`]: board.raw });
    const reported: Array<[string, unknown]> = [];
    const failing = { ...store, transact: () => Promise.reject(new Error('disk full')) } as unknown as typeof store;

    const result = await importLegacyBoards({
      ...base(failing, blobs), storage: fake.storage, removeKey: fake.removeKey, report: (where, error) => { reported.push([where, error]); },
    });

    expect(result.imported).toEqual([]);
    expect(result.failed).toEqual([{ localId: board.id, reason: 'disk full' }]);
    expect(reported).toHaveLength(1);
    expect(fake.data.has(`${PREFIX}${board.id}`)).toBe(true);
    expect(await listBoards(store)).toEqual([]);
  });

  it('reports an unparseable board and keeps it', async () => {
    const { store, blobs } = setup();
    const fake = fakeStorage({ [`${PREFIX}local-${uuid()}`]: '{not json' });
    const reported: unknown[] = [];
    const result = await importLegacyBoards({ ...base(store, blobs), storage: fake.storage, removeKey: fake.removeKey, report: (_w, error) => { reported.push(error); } });
    expect(result.failed).toHaveLength(1);
    expect(reported).toHaveLength(1);
    expect(fake.data.size).toBe(1);
  });
});
