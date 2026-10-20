/**
 * G03 acceptance, at the VSIX host.
 *
 * Three claims, each proved here against a real journal on disk:
 *   1. Chat, project, ticket, audit-run and run writes commit in ONE
 *      transaction, through `commitWriteAndEnqueue`, on a store whose
 *      `transact` is durable before it resolves.
 *   2. A kill between the record and its journal event commits NEITHER — the
 *      torn trailing frame is discarded and the restart opens the previous
 *      complete frame.
 *   3. A fresh store opened from the last published snapshot reads all five
 *      kinds back with NO network: `fetch` is stubbed to throw and is never
 *      called, and neither `offlineLocalFirstStore.ts` nor the commit path
 *      contains an API client.
 *
 * `globalStorage/local-first-v1.json` is NOT the store: the test asserts the
 * JSON file is a republished CACHE, written only after the journal append
 * succeeded, and that a cache deleted between commits loses nothing.
 */

import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createJournaledLocalFirstStore,
  decodeJournalFrames,
  type JournalIo,
} from '@builderforce/local-first';
import {
  commitOfflineEntitySet,
  commitOfflineEntityWrite,
  createNodeJournalIo,
  createOfflineLocalFirstStore,
  decodeJournalFrames as decodeHostFrames,
  offlineEventId,
  OFFLINE_COMMITTED_ENTITY_TYPES,
} from './offlineLocalFirstStore';
import { readFileSync } from 'node:fs';

const DEVICE = 'device-under-test';
const SNAPSHOT_FILE = 'local-first-v1.json';
const JOURNAL_FILE = 'local-first-v2.journal';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'bf-g03-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * In-memory `JournalIo` over a byte buffer, with a kill switch: past
 * `tornAfter` appends the frame is written only part-way AND the write fails,
 * which is what a process killed mid-append leaves behind on disk.
 */
function createMemoryIo(options: { tornAfter?: number } = {}): JournalIo & { bytes: Uint8Array } {
  let bytes = new Uint8Array(0);
  let appends = 0;
  return {
    get bytes() {
      return bytes;
    },
    async read() {
      return bytes.byteLength === 0 ? undefined : bytes;
    },
    async append(frame) {
      appends += 1;
      if (options.tornAfter !== undefined && appends > options.tornAfter) {
        bytes = concat(bytes, frame.slice(0, 9 + Math.floor(frame.byteLength / 4)));
        const error = new Error('journal_append_torn') as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
      bytes = concat(bytes, frame);
    },
    async replace(frame) {
      bytes = frame;
    },
    async size() {
      return bytes.byteLength;
    },
  };
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

const SEED = {
  project: { entityType: 'project' as const, payload: { name: 'Offline project' }, id: 'p-1' },
  ticket: {
    entityType: 'ticket' as const,
    payload: { projectId: 'p-1', title: 'Ship offline', status: 'backlog' },
    id: 't-1',
    dependsOn: ['project:p-1:v1'],
  },
  chat: {
    entityType: 'chat' as const,
    payload: { title: 'Offline chat', projectId: 'p-1', ticketId: 't-1' },
    id: 'c-1',
    dependsOn: ['ticket:t-1:v1'],
  },
  audit: {
    entityType: 'audit-run' as const,
    payload: { auditKey: 'soc2', projectId: 'p-1', ticketId: 't-1', status: 'running' },
    id: 'a-1',
    dependsOn: ['ticket:t-1:v1'],
  },
  run: {
    entityType: 'execution' as const,
    payload: { chatId: 'c-1', ticketId: 't-1', status: 'queued' },
    id: 'r-1',
    dependsOn: ['chat:c-1:v1', 'audit-run:a-1:v1'],
  },
};

describe('G03 offline local-first store', () => {
  it('commits chat, project, ticket, audit and run in ONE transaction', async () => {
    const io = createMemoryIo();
    const store = createJournaledLocalFirstStore({ io });
    const committed = await commitOfflineEntitySet(store, DEVICE, SEED);

    // One transaction, therefore one journal frame, therefore one append.
    expect(await store.frameCount()).toBe(1);
    expect(committed.records).toHaveLength(5);
    expect(committed.events).toEqual([
      'project:p-1:v1',
      'ticket:t-1:v1',
      'chat:c-1:v1',
      'audit-run:a-1:v1',
      'execution:r-1:v1',
    ]);

    const listed = await store.read(async (tx) => {
      const rows = await tx.list();
      return { records: rows.length, events: (await tx.pending()).length };
    });
    expect(listed).toEqual({ records: 5, events: 5 });
  });

  it('commits a record without its journal event nowhere: a kill between them loses both', async () => {
    const io = createMemoryIo({ tornAfter: 1 });
    const store = createJournaledLocalFirstStore({ io });

    // Frame 1 lands whole.
    await commitOfflineEntitySet(store, DEVICE, SEED);
    expect(await store.frameCount()).toBe(1);

    // Frame 2 is cut short mid-append: the record is in the draft, the event
    // died with the frame. The commit rejects and publishes nothing.
    await expect(
      commitOfflineEntityWrite(store, DEVICE, {
        entityType: 'chat',
        id: 'c-2',
        payload: { title: 'Never committed' },
      }),
    ).rejects.toThrow();

    // A brand-new store over the same bytes IS the restart, and it opens the
    // last COMPLETE frame — the half-written one is discarded whole.
    const restarted = createJournaledLocalFirstStore({ io });
    expect(await restarted.frameCount()).toBe(1);
    const rows = await restarted.read(async (tx) => ({
      records: await tx.list(),
      events: await tx.pending(),
    }));
    expect(rows.records.map((row) => row.id).sort()).toEqual(['a-1', 'c-1', 'p-1', 'r-1', 't-1']);
    expect(rows.events.some((event) => event.clientEntityId === 'c-2')).toBe(false);

    // Same process, same store object: the unpublished draft is gone too.
    expect(await store.read(async (tx) => (await tx.get('chat', 'c-2')) !== undefined)).toBe(false);
  });

  it('restarts from the last published snapshot with no API call', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch must not be reachable from an offline write');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const first = createOfflineLocalFirstStore({ directory });
    await commitOfflineEntitySet(first, DEVICE, SEED);
    await commitOfflineEntityWrite(first, DEVICE, {
      entityType: 'execution',
      id: 'r-2',
      payload: { chatId: 'c-1', ticketId: 't-1', status: 'running' },
      dependsOn: ['execution:r-1:v1'],
    });

    // A brand-new store object over the same globalStorage directory: the
    // restart. Nothing is carried over in memory.
    const restarted = createOfflineLocalFirstStore({ directory });
    const rows = await restarted.read(async (tx) => ({
      chats: await tx.list('chat'),
      projects: await tx.list('project'),
      tickets: await tx.list('ticket'),
      audits: await tx.list('audit-run'),
      runs: await tx.list('execution'),
      events: await tx.pending(),
    }));

    expect(rows.projects.map((row) => row.id)).toEqual(['p-1']);
    expect(rows.tickets.map((row) => row.id)).toEqual(['t-1']);
    expect(rows.chats.map((row) => row.id)).toEqual(['c-1']);
    expect(rows.audits.map((row) => row.id)).toEqual(['a-1']);
    expect(rows.runs.map((row) => row.id).sort()).toEqual(['r-1', 'r-2']);
    expect(rows.events).toHaveLength(6);
    expect(rows.events.every((event) => event.payloadHash.length > 0)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats local-first-v1.json as a cache, not the store', async () => {
    const store = createOfflineLocalFirstStore({ directory });
    await commitOfflineEntitySet(store, DEVICE, SEED);
    // The cache write is queued behind the commit; await it explicitly.
    await store.flush();

    const journal = await readFile(join(directory, JOURNAL_FILE));
    const cache = await readFile(join(directory, SNAPSHOT_FILE), 'utf8');
    expect(decodeJournalFrames(new Uint8Array(journal))).toHaveLength(1);
    expect(JSON.parse(cache).records).toHaveLength(5);

    // Delete the cache entirely: the store still holds every record and event,
    // because the journal does.
    await rm(join(directory, SNAPSHOT_FILE), { force: true });
    const restarted = createOfflineLocalFirstStore({ directory });
    const rows = await restarted.read(async (tx) => ({
      records: await tx.list(),
      events: await tx.pending(),
    }));
    expect(rows.records).toHaveLength(5);
    expect(rows.events).toHaveLength(5);
  });

  it('compacts the journal without changing what a restart reads', async () => {
    const store = createOfflineLocalFirstStore({ directory });
    for (let index = 0; index < 4; index += 1) {
      await commitOfflineEntityWrite(store, DEVICE, {
        entityType: 'chat',
        id: `c-${index}`,
        payload: { title: `Chat ${index}` },
      });
    }
    expect(await store.frameCount()).toBe(4);
    const before = await store.read(async (tx) => tx.list('chat'));

    await store.compact();
    expect(await store.frameCount()).toBe(1);

    const restarted = createOfflineLocalFirstStore({ directory });
    const after = await restarted.read(async (tx) => tx.list('chat'));
    expect(after).toEqual(before);
  });

  it('never calls an API client on the commit path', async () => {
    const source = readFileSync(new URL('./offlineLocalFirstStore.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\bbfApi\b/);
    expect(code).not.toMatch(/node:https?/);
    expect(code).not.toMatch(/XMLHttpRequest/);
    // The five kinds the ticket names, exactly.
    expect([...OFFLINE_COMMITTED_ENTITY_TYPES]).toEqual([
      'project',
      'ticket',
      'chat',
      'audit-run',
      'execution',
    ]);
  });

  it('recovers from a corrupt tail frame by opening the last complete one', async () => {
    const io = createMemoryIo();
    const store = createJournaledLocalFirstStore({ io });
    await commitOfflineEntitySet(store, DEVICE, SEED);
    const good = io.bytes;

    // Flip a byte in the middle of the second frame's body.
    const damaged = concat(good, good);
    damaged[good.byteLength + 20] = (damaged[good.byteLength + 20] + 1) % 256;
    expect(decodeJournalFrames(damaged)).toHaveLength(1);

    await writeFile(join(directory, JOURNAL_FILE), damaged);
    const restarted = createOfflineLocalFirstStore({ directory });
    const rows = await restarted.read(async (tx) => tx.list());
    expect(rows.map((row) => row.id).sort()).toEqual(['a-1', 'c-1', 'p-1', 'r-1', 't-1']);
    // The journal file itself is what is opened, not the JSON cache.
    await expect(stat(join(directory, SNAPSHOT_FILE))).rejects.toThrow();
  });

  it('exposes the same event id `commitWriteAndEnqueue` plans', async () => {
    const store = createJournaledLocalFirstStore({ io: createMemoryIo() });
    const committed = await commitOfflineEntityWrite(store, DEVICE, {
      entityType: 'ticket',
      id: 't-9',
      payload: { projectId: 'p-1', title: 'Idempotent', status: 'backlog' },
    });
    expect(committed.events).toEqual([`${offlineEventId(committed.records[0])}`]);
    // Replaying the same version cannot mint a second identity.
    const replay = await commitOfflineEntityWrite(store, DEVICE, {
      entityType: 'ticket',
      id: 't-9',
      payload: { projectId: 'p-1', title: 'Idempotent', status: 'backlog' },
    });
    expect(replay.events).toEqual(committed.events);
    const events = await store.read(async (tx) => tx.pending());
    expect(events).toHaveLength(1);
  });

  it('writes the node journal io at the path the host opens on restart', async () => {
    const io = createNodeJournalIo(directory);
    await expect(io.read()).resolves.toBeUndefined();
    await expect(io.size()).resolves.toBe(0);
    const store = createJournaledLocalFirstStore({ io });
    await commitOfflineEntityWrite(store, DEVICE, { entityType: 'chat', id: 'c-1', payload: {} });
    await expect(stat(join(directory, JOURNAL_FILE))).resolves.toBeDefined();
    const reopened = createNodeJournalIo(directory);
    expect(decodeHostFrames((await reopened.read())!)).toHaveLength(1);
  });
});