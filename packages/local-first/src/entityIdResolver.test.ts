import { describe, expect, it } from 'vitest';
import { entityIdResolver } from './entityIdResolver.js';
import type { LocalId, SyncId } from './entityId.js';
import { createMemoryLocalFirstStore, newLocalRecord } from './store.js';

const ACCOUNT_A = { kind: 'bound' as const, tenantId: '7', accountId: 'a' };
const ACCOUNT_B = { kind: 'bound' as const, tenantId: '7', accountId: 'b' };
const TICKET_A = '11111111-1111-4111-8111-111111111111' as LocalId;
const TICKET_B = '22222222-2222-4222-8222-222222222222' as LocalId;
const SPEC = '33333333-3333-4333-8333-333333333333' as LocalId;
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

  it('without a destination returns the EARLIEST mapping', async () => {
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
});
