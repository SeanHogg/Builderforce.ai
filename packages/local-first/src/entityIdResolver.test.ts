import { describe, expect, it } from 'vitest';
import { entityIdResolver } from './entityIdResolver.js';
import type { LocalId, SyncId } from './entityId.js';
import { createMemoryLocalFirstStore, newLocalRecord } from './store.js';
import { UNBOUND_DESTINATION, earliestMapping } from './records.js';
import { ingestServerRecords } from './ingestServerRecords.js';

const ACCOUNT_A = { kind: 'bound' as const, tenantId: '7', accountId: 'a' };
const ACCOUNT_B = { kind: 'bound' as const, tenantId: '8', accountId: 'b' };
const TICKET_A = '11111111-1111-4111-8111-111111111111' as LocalId;
const TICKET_B = '22222222-2222-4222-8222-222222222222' as LocalId;
const SPEC = '33333333-3333-4333-8333-333333333333' as LocalId;
const UNBOUND = '44444444-4444-4444-8444-444444444444' as LocalId;
const STEP = '55555555-5555-4555-8555-555555555555' as LocalId;
const sync = (n: number) => n as SyncId;

async function seeded() {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord({ id: TICKET_A, entityType: 'ticket', payload: {}, deviceId: 'd', destination: ACCOUNT_A }));
    // Same SyncId in two destinations (two accounts' servers each numbered a ticket 40).
    await tx.putMapping({ destination: ACCOUNT_A, entityType: 'ticket', clientEntityId: TICKET_A, syncId: 40, serverVersion: 1 });
    await tx.putMapping({ destination: ACCOUNT_B, entityType: 'ticket', clientEntityId: TICKET_B, syncId: 40, serverVersion: 1 });
    await tx.putMapping({ destination: ACCOUNT_A, entityType: 'ticket', clientEntityId: SPEC, serverId: 'spec:5', serverVersion: 1 });
  });
  return store;
}

describe('regression: mappingByServerId honours the destination', () => {
  it('returns the row of the destination asked for, not the first of any', async () => {
    const store = await seeded();
    expect(await store.read((tx) => tx.mappingByServerId('ticket', '40', ACCOUNT_B))).toMatchObject({ clientEntityId: TICKET_B });
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 40, ACCOUNT_A))).toMatchObject({ clientEntityId: TICKET_A });
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 40, { kind: 'bound', tenantId: '9' }))).toBeUndefined();
  });

  it('an account scope ({ tenantId }) never crosses into another tenant; it includes unbound rows', async () => {
    const store = await seeded();
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 40, { tenantId: '7' }))).toMatchObject({ clientEntityId: TICKET_A });
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 40, { tenantId: '8' }))).toMatchObject({ clientEntityId: TICKET_B });
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 40, { tenantId: '7', accountId: 'b' }))).toBeUndefined();
    await store.transact((tx) => tx.putMapping({ destination: UNBOUND_DESTINATION, entityType: 'ticket', clientEntityId: UNBOUND, syncId: 41, serverVersion: 1 }));
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 41, { tenantId: '8' }))).toMatchObject({ clientEntityId: UNBOUND });
  });

  it('with no scope at all (legacy) returns the EARLIEST mapping of any destination', async () => {
    const store = await seeded();
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 40))).toMatchObject({ clientEntityId: TICKET_A });
  });

  it('mappingByExternalRef finds a tier ticket; the legacy kind:ref lookup still resolves', async () => {
    const store = await seeded();
    expect(await store.read((tx) => tx.mappingByExternalRef('ticket', 'spec:5', ACCOUNT_A))).toMatchObject({ clientEntityId: SPEC, syncId: null });
    expect(await store.read((tx) => tx.mappingByExternalRef('ticket', 'spec:5', ACCOUNT_B))).toBeUndefined();
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 'spec:5'))).toMatchObject({ clientEntityId: SPEC });
  });
});

describe('entityIdResolver', () => {
  it('syncIdOf: in the given destination, or the record\'s own when omitted; null before a receipt', async () => {
    const store = await seeded();
    const resolver = entityIdResolver(store);
    expect(await resolver.syncIdOf('ticket', TICKET_A)).toBe(40);
    expect(await resolver.syncIdOf('ticket', TICKET_B, ACCOUNT_B)).toBe(40);
    expect(await resolver.syncIdOf('ticket', TICKET_B, ACCOUNT_A)).toBeNull();
    expect(await resolver.syncIdOf('ticket', SPEC, ACCOUNT_A)).toBeNull();
    expect(await resolver.syncIdOf('ticket', '42' as LocalId)).toBeNull();
  });

  it('localIdOf: destination-scoped, earliest when omitted', async () => {
    const resolver = entityIdResolver(await seeded());
    expect(await resolver.localIdOf('ticket', sync(40))).toBe(TICKET_A);
    expect(await resolver.localIdOf('ticket', sync(40), ACCOUNT_B)).toBe(TICKET_B);
    expect(await resolver.localIdOf('ticket', sync(41))).toBeNull();
  });

  it('resolve reads every EntityRef shape', async () => {
    const resolver = entityIdResolver(await seeded());
    expect(await resolver.resolve('ticket', { local: TICKET_A })).toEqual({ localId: TICKET_A, syncId: 40 });
    expect(await resolver.resolve('ticket', { sync: sync(40) }, ACCOUNT_B)).toEqual({ localId: TICKET_B, syncId: 40 });
    expect(await resolver.resolve('ticket', { tier: { kind: 'spec', ref: '5' } })).toEqual({ localId: SPEC, syncId: null });
    expect(await resolver.resolve('ticket', { tier: { kind: 'spec', ref: '6' } })).toEqual({ localId: null, syncId: null });
  });

  it('an account scope keeps another tenant\'s SyncId 40 out', async () => {
    const resolver = entityIdResolver(await seeded());
    expect(await resolver.localIdOf('ticket', sync(40), { tenantId: '8' })).toBe(TICKET_B);
    expect(await resolver.localIdOf('ticket', sync(40), { tenantId: '9' })).toBeNull();
    expect(await resolver.syncIdOf('ticket', TICKET_A, { tenantId: '8' })).toBeNull();
    expect(await resolver.syncIdOf('ticket', TICKET_A, { tenantId: '7' })).toBe(40);
  });

  it('accepts any reader of the store (only `read` is used)', async () => {
    const store = await seeded();
    const resolver = entityIdResolver({ read: (work) => store.read(work) });
    expect(await resolver.localIdOf('ticket', sync(40), ACCOUNT_B)).toBe(TICKET_B);
  });
});

describe('regression: a run step mapping (syncId: null, serverId text) is the same server row, not a message', () => {
  async function withStep() {
    const store = createMemoryLocalFirstStore();
    await store.transact((tx) => tx.putMapping({ destination: ACCOUNT_A, entityType: 'message', clientEntityId: STEP, syncId: null, serverId: '5', serverVersion: 1 }));
    return store;
  }

  it('mappingByServerId(5) falls back to the null-syncId row with key text "5"', async () => {
    const store = await withStep();
    expect(await store.read((tx) => tx.mappingByServerId('message', 5))).toMatchObject({ clientEntityId: STEP, syncId: null });
  });

  it('a row that CARRIES the SyncId wins over the fallback', async () => {
    const store = await withStep();
    await store.transact((tx) => tx.putMapping({ destination: ACCOUNT_A, entityType: 'message', clientEntityId: TICKET_A, syncId: 5, serverVersion: 1 }));
    expect(await store.read((tx) => tx.mappingByServerId('message', '5'))).toMatchObject({ clientEntityId: TICKET_A });
  });

  it('ingesting the step row again lands on the same LocalId (no duplicate minted)', async () => {
    const store = await withStep();
    const result = await ingestServerRecords(store, [{
      entityType: 'message', serverId: '5', payload: { text: 'step' }, updatedAt: '2026-11-09T00:00:00.000Z', destination: ACCOUNT_A,
    }]);
    expect(result.clientIds).toEqual([STEP]);
    expect(await store.read((tx) => tx.mapping('message', STEP, ACCOUNT_A))).toMatchObject({ syncId: null, serverId: '5' });
  });

  it('the resolver never hands a step\'s LocalId out as message SyncId 5', async () => {
    const resolver = entityIdResolver(await withStep());
    expect(await resolver.localIdOf('message', sync(5))).toBeNull();
    expect(await resolver.syncIdOf('message', STEP, ACCOUNT_A)).toBeNull();
  });
});

describe('regression: an ingested server row finds its mapping in its own tenant only', () => {
  const row = (destination: { kind: 'bound'; tenantId: string; projectId?: string }) => ({
    entityType: 'ticket' as const, serverId: '40', payload: { title: 't' }, updatedAt: '2026-11-10T00:00:00.000Z', destination,
  });

  it('tenant 8\'s ticket 40 lands on tenant 8\'s LocalId, never on tenant 7\'s older mapping', async () => {
    const store = await seeded();
    const result = await ingestServerRecords(store, [row({ kind: 'bound', tenantId: '8', projectId: 'p' })]);
    expect(result.clientIds).toEqual([TICKET_B]);
  });

  it('a tenant with no mapping of ticket 40 mints its own LocalId', async () => {
    const store = await seeded();
    const result = await ingestServerRecords(store, [row({ kind: 'bound', tenantId: '9' })]);
    expect(result.clientIds).toHaveLength(1);
    expect(result.clientIds[0]).not.toBe(TICKET_A);
    expect(result.clientIds[0]).not.toBe(TICKET_B);
  });
});

describe('regression: signed-out and platform-instance scopes', () => {
  const STAGING = { kind: 'bound' as const, platformInstance: 'https://staging.example', tenantId: '7' };
  const PROD = { kind: 'bound' as const, platformInstance: 'https://prod.example', tenantId: '7' };

  it('the signed-out scope (UNBOUND_DESTINATION) reads unbound rows only, never an account', async () => {
    const store = await seeded();
    await store.transact(async (tx) => {
      await tx.putMapping({ destination: UNBOUND_DESTINATION, entityType: 'ticket', clientEntityId: UNBOUND, syncId: 41, serverVersion: 1 });
    });
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 40, UNBOUND_DESTINATION))).toBeUndefined();
    expect(await store.read((tx) => tx.mappingByServerId('ticket', 41, UNBOUND_DESTINATION))).toMatchObject({ clientEntityId: UNBOUND });
    expect(await entityIdResolver(store).localIdOf('ticket', sync(40), UNBOUND_DESTINATION)).toBeNull();
  });

  it('a tenant id on two platform instances is two accounts when the scope names the instance', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      // Staging mapped FIRST: an instance-blind tenant scope picks it.
      await tx.putMapping({ destination: STAGING, entityType: 'chat', clientEntityId: TICKET_A, syncId: 40, serverVersion: 1 });
      await tx.putMapping({ destination: PROD, entityType: 'chat', clientEntityId: TICKET_B, syncId: 40, serverVersion: 1 });
    });
    expect(await store.read((tx) => tx.mappingByServerId('chat', 40, { tenantId: '7', platformInstance: 'https://prod.example' })))
      .toMatchObject({ clientEntityId: TICKET_B });
    expect(await store.read((tx) => tx.mappingByServerId('chat', 40, { tenantId: '7', platformInstance: 'https://staging.example' })))
      .toMatchObject({ clientEntityId: TICKET_A });
    expect(await store.read((tx) => tx.mappingByServerId('chat', 40, { tenantId: '7', platformInstance: 'https://other.example' })))
      .toBeUndefined();
  });
});

describe('earliestMapping: the one earliest-in-scope pick', () => {
  const rows = [
    { destination: ACCOUNT_B, entityType: 'ticket' as const, clientEntityId: TICKET_B, syncId: sync(40), serverVersion: 1, mappedSeq: 2 },
    { destination: ACCOUNT_A, entityType: 'ticket' as const, clientEntityId: TICKET_A, syncId: sync(40), serverVersion: 1, mappedSeq: 3 },
    { destination: ACCOUNT_A, entityType: 'chat' as const, clientEntityId: SPEC, syncId: sync(40), serverVersion: 1, mappedSeq: 1 },
  ];
  const is40 = (row: { syncId?: SyncId | null }) => row.syncId === 40;

  it('takes the lowest mappedSeq of the type, inside the scope', () => {
    expect(earliestMapping(rows, 'ticket', undefined, is40)?.clientEntityId).toBe(TICKET_B);
    expect(earliestMapping(rows, 'ticket', { tenantId: '7' }, is40)?.clientEntityId).toBe(TICKET_A);
    expect(earliestMapping(rows, 'ticket', UNBOUND_DESTINATION, is40)).toBeUndefined();
    expect(earliestMapping(rows, 'ticket', undefined, () => false)).toBeUndefined();
  });

  it('gives the same answer as the store', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      for (const row of rows) await tx.putMapping(row);
    });
    const facts = await store.export();
    for (const scope of [undefined, { tenantId: '7' }, { tenantId: '8' }, ACCOUNT_A]) {
      const fromStore = await store.read((tx) => tx.mappingByServerId('ticket', 40, scope));
      expect(earliestMapping(facts.mappings, 'ticket', scope, is40)?.clientEntityId).toBe(fromStore?.clientEntityId);
    }
  });
});
