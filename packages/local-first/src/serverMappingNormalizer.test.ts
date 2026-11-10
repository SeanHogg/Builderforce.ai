/**
 * regression: typed entity ids (design §4, §8) — legacy mapping rows read through ONE
 * tolerant normaliser on load AND on delta-apply; nothing is deleted, writes carry both fields.
 */
import { describe, expect, it } from 'vitest';
import { normalizeServerMapping, UNBOUND_DESTINATION, type ServerMapping } from './records.js';
import { createMemoryLocalFirstStore } from './store.js';
import { encodeJournalFrame } from './journalCodec.js';
import { decodeJournalFrames } from './journalReplay.js';
import { decodeTransactionalSnapshot, encodeTransactionalSnapshot } from './transactionalRecord.js';

const BOUND = { kind: 'bound' as const, tenantId: '7' };
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';
const U = '44444444-4444-4444-8444-444444444444';
const N = '55555555-5555-4555-8555-555555555555';
const MIRROR_UUID = '99999999-9999-4999-8999-999999999999';

/** Rows as an older extension wrote them: `serverId` text only, or a number, or a tier ref, or a UUID. */
const legacyRows = (): ServerMapping[] => [
  { destination: BOUND, entityType: 'ticket', clientEntityId: T, serverId: '501', serverVersion: 2 },
  { destination: BOUND, entityType: 'chat', clientEntityId: C, serverId: 61651, serverVersion: 1 },
  { destination: BOUND, entityType: 'ticket', clientEntityId: S, serverId: 'spec:5', serverVersion: 1 },
  { destination: BOUND, entityType: 'usage', clientEntityId: U, serverId: MIRROR_UUID, serverVersion: 1 },
  { destination: UNBOUND_DESTINATION, entityType: 'project', clientEntityId: N, serverVersion: 1 },
] as unknown as ServerMapping[];

describe('regression: normalizeServerMapping', () => {
  it('derives syncId from decimal / numeric serverId, moves kind:ref to externalRef, keeps a UUID as text', () => {
    const [decimal, numeric, tier, uuid, bare] = legacyRows().map(normalizeServerMapping);
    expect(decimal).toEqual({ destination: BOUND, entityType: 'ticket', clientEntityId: T, syncId: 501, serverId: '501', serverVersion: 2 });
    expect(numeric).toMatchObject({ syncId: 61651, serverId: '61651' });
    expect(tier).toMatchObject({ syncId: null, externalRef: 'spec:5', serverId: 'spec:5' });
    expect(uuid).toMatchObject({ syncId: null, serverId: MIRROR_UUID });
    expect(uuid!.externalRef).toBeUndefined();
    expect(bare).toMatchObject({ syncId: null, serverVersion: 1 });
    expect(bare!.serverId).toBeUndefined();
  });

  it('fills serverId text from syncId so a write carries BOTH fields', () => {
    const row = normalizeServerMapping({ destination: BOUND, entityType: 'ticket', clientEntityId: T, syncId: 9, serverVersion: 1 });
    expect(row).toMatchObject({ syncId: 9, serverId: '9' });
  });

  it('prefers syncId over serverId, and keeps an EXPLICIT null (a step id is not a message id)', () => {
    expect(normalizeServerMapping({ destination: BOUND, entityType: 'ticket', clientEntityId: T, syncId: 9, serverId: '8', serverVersion: 1 }).syncId).toBe(9);
    expect(normalizeServerMapping({ destination: BOUND, entityType: 'message', clientEntityId: T, syncId: null, serverId: '8', serverVersion: 1 }).syncId).toBeNull();
  });

  it('returns an already-normal row as is', () => {
    const row: ServerMapping = { destination: BOUND, entityType: 'ticket', clientEntityId: T, syncId: 501 as ServerMapping['syncId'], serverId: '501', serverVersion: 2 };
    expect(normalizeServerMapping(row)).toBe(row);
  });
});

describe('regression: stores normalise legacy mapping rows', () => {
  it('on load: every row survives, each with syncId', async () => {
    const store = createMemoryLocalFirstStore({ mappings: legacyRows() });
    const { mappings } = await store.export();
    expect(mappings).toHaveLength(5);
    expect(mappings.map((m) => m.syncId)).toEqual([501, 61651, null, null, null]);
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 501))).toMatchObject({ clientEntityId: T });
    expect(await store.read((tx) => tx.mappingByServerId('chat', '61651'))).toMatchObject({ clientEntityId: C });
    expect(await store.read((tx) => tx.mappingByExternalRef('ticket', 'spec:5'))).toMatchObject({ clientEntityId: S });
    expect(await store.read((tx) => tx.mappingByServerId('usage', MIRROR_UUID))).toMatchObject({ clientEntityId: U });
  });

  it('on delta-apply (another window committed a legacy row): it is normalised, not dropped', async () => {
    const store = createMemoryLocalFirstStore();
    store.applyDelta({ mappings: legacyRows() });
    const { mappings } = await store.export();
    expect(mappings).toHaveLength(5);
    expect(mappings[0]).toMatchObject({ syncId: 501, serverId: '501' });
    expect(mappings[2]).toMatchObject({ externalRef: 'spec:5', syncId: null });
  });

  it('putMapping writes both syncId and serverId text', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'ticket', clientEntityId: T, syncId: 77, serverVersion: 1 }));
    await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat', clientEntityId: C, serverId: '78', serverVersion: 1 }));
    const { mappings } = await store.export();
    expect(mappings).toEqual([
      expect.objectContaining({ clientEntityId: T, syncId: 77, serverId: '77' }),
      expect.objectContaining({ clientEntityId: C, syncId: 78, serverId: '78' }),
    ]);
  });
});

describe('regression: "earliest mapping" survives a restart (mappedSeq)', () => {
  // Z sorts AFTER A by key, but is mapped FIRST: the canonical (key-sorted) encodings must not flip it.
  const Z = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const A = '00000000-0000-4000-8000-00000000000a';

  async function mappedZThenA() {
    const store = createMemoryLocalFirstStore();
    await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat', clientEntityId: Z, syncId: 61651, serverVersion: 1 }));
    await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat', clientEntityId: A, syncId: 61651, serverVersion: 1 }));
    return store;
  }

  it('in memory: the first mapped wins, and an update does not move it', async () => {
    const store = await mappedZThenA();
    await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat', clientEntityId: Z, syncId: 61651, serverVersion: 2 }));
    expect(await store.read((tx) => tx.mappingByServerId('chat', 61651))).toMatchObject({ clientEntityId: Z });
  });

  it('after a reload through the journal frame and the transactional snapshot encodings', async () => {
    const snapshot = await (await mappedZThenA()).export();
    const viaJournal = decodeJournalFrames(encodeJournalFrame(snapshot)).at(-1)!;
    const viaRecord = decodeTransactionalSnapshot(encodeTransactionalSnapshot(snapshot));
    for (const reloaded of [viaJournal, viaRecord]) {
      expect(reloaded.mappings.map((m) => m.clientEntityId)).toEqual([A, Z]); // the encodings sort by key
      const store = createMemoryLocalFirstStore(reloaded);
      expect(await store.read((tx) => tx.mappingByServerId('chat', 61651))).toMatchObject({ clientEntityId: Z });
    }
  });

  it('legacy rows (no mappedSeq) are backfilled after every persisted one, in load order', async () => {
    const legacy = { destination: BOUND, entityType: 'chat' as const, clientEntityId: A, serverId: '7', serverVersion: 1 };
    const persisted = { destination: BOUND, entityType: 'chat' as const, clientEntityId: Z, syncId: 7, serverId: '7', serverVersion: 1, mappedSeq: 3 };
    const store = createMemoryLocalFirstStore({ mappings: [legacy, persisted] as ServerMapping[] });
    const { mappings } = await store.export();
    expect(mappings.find((m) => m.clientEntityId === A)?.mappedSeq).toBe(4);
    expect(await store.read((tx) => tx.mappingByServerId('chat', 7))).toMatchObject({ clientEntityId: Z });
    // A new mapping after load continues the sequence.
    await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat', clientEntityId: T, syncId: 8, serverVersion: 1 }));
    expect((await store.read((tx) => tx.mapping('chat', T, BOUND)))?.mappedSeq).toBe(5);
  });
});
