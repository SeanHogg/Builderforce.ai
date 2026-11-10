/**
 * regression: `LocalChatIdentity.localIdFor` resolves a SERVER chat id inside the active account
 * when the host passes its scope (typed-entity-ids §3). Two accounts each numbered a chat 40; the
 * scoped lookup never hands one account's caller the other's chat.
 */

import { describe, expect, it, vi } from 'vitest';
import { UNBOUND_DESTINATION, createMemoryLocalFirstStore, newLocalRecord, type EntityDestination } from '@builderforce/local-first';
import { createLocalChatIdentity } from './chatIdentity';

const DEVICE = 'device-1';
const A: EntityDestination = { kind: 'bound', platformInstance: 'https://api.example', tenantId: '7' };
const B: EntityDestination = { kind: 'bound', platformInstance: 'https://api.example', tenantId: '8' };
const CHAT_A = '00000000-0000-4000-8000-0000000000a1';
const CHAT_B = '00000000-0000-4000-8000-0000000000b1';

async function twoAccounts(current: EntityDestination | undefined) {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    for (const [clientId, localId] of [[CHAT_A, 1], [CHAT_B, 2]] as const) {
      await tx.put(newLocalRecord({
        id: clientId, entityType: 'chat', deviceId: DEVICE, destination: UNBOUND_DESTINATION,
        payload: { clientId, chat: { id: localId, title: `chat ${localId}` } },
      }));
    }
    // Account A's binding is the older one: an unscoped "first mapping" pick is A's.
    await tx.putMapping({ destination: A, entityType: 'chat', clientEntityId: CHAT_A, syncId: 40, serverVersion: 1 });
    await tx.putMapping({ destination: B, entityType: 'chat', clientEntityId: CHAT_B, syncId: 40, serverVersion: 1 });
    // A step-like row: the same key text, but the server said it is not a chat SyncId.
    await tx.putMapping({ destination: B, entityType: 'chat', clientEntityId: CHAT_A, syncId: null, serverId: '41', serverVersion: 1 });
  });
  const identity = createLocalChatIdentity({
    store, deviceId: DEVICE,
    port: { destination: () => current, allowed: () => true, createServerChat: vi.fn(async () => null) },
  });
  return identity;
}

describe('regression: localIdFor stays inside the scope it is given', () => {
  it('server chat 40 is each account\'s own chat', async () => {
    const identity = await twoAccounts(A);
    expect(await identity.localIdFor(40, { tenantId: '8' })).toBe(2);
    expect(await identity.localIdFor(40, { tenantId: '7' })).toBe(1);
    expect(await identity.localIdFor(40, { tenantId: '9' })).toBeUndefined();
  });

  it('the signed-out scope resolves no account\'s chat', async () => {
    const identity = await twoAccounts(undefined);
    expect(await identity.localIdFor(40, UNBOUND_DESTINATION)).toBeUndefined();
  });

  it('a row whose server said "not a SyncId" is never the chat', async () => {
    const identity = await twoAccounts(B);
    expect(await identity.localIdFor(41, { tenantId: '8' })).toBeUndefined();
  });

  it('without a scope it keeps reading the port\'s current destination exactly', async () => {
    expect(await (await twoAccounts(B)).localIdFor(40)).toBe(2);
    expect(await (await twoAccounts(undefined)).localIdFor(40)).toBeUndefined();
  });
});
