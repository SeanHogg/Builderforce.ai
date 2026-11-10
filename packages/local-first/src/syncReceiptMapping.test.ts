/**
 * regression: typed entity ids (design §4, §8).
 * - A receipt with `serverVersion` but no id (mirror / usage row) still writes the mapping, so the
 *   row stops re-queueing as an import.
 * - The HTTP transport accepts a numeric `syncId` / `serverId` instead of dropping it.
 */
import { describe, expect, it } from 'vitest';
import { createHttpSyncTransport, type HttpSyncResponse } from './httpSyncTransport.js';
import { isImported } from './journalRules.js';
import { createPlatformPolicy } from './policy.js';
import type { SyncReceipt } from './records.js';
import { createMemoryLocalFirstStore, type LocalFirstStore } from './store.js';
import { createSyncCoordinator, type SyncPushBatch } from './sync.js';

const AT = '2026-11-09T00:00:00.000Z';
const BOUND = { kind: 'bound' as const, tenantId: '7' };
const USAGE = '11111111-1111-4111-8111-111111111111';
const TICKET = '22222222-2222-4222-8222-222222222222';
const MIRROR_UUID = '99999999-9999-4999-8999-999999999999';

function coordinatorFor(store: LocalFirstStore, answer: (batch: SyncPushBatch) => Array<Omit<SyncReceipt, 'receivedAt'>>) {
  const policy = createPlatformPolicy();
  policy.set({ synchronize: true });
  return createSyncCoordinator({
    store,
    policy,
    deviceId: 'd',
    lease: { run: (_owner, work) => work() },
    transport: {
      async push(batch) {
        return answer(batch).map((receipt) => ({ receivedAt: AT, ...receipt }));
      },
      async pull() {
        return { records: [] };
      },
    },
  });
}

async function appendImport(store: LocalFirstStore, entityType: 'usage' | 'ticket', id: string): Promise<void> {
  await store.transact((tx) => tx.append({
    idempotencyKey: `${entityType}:${id}`, clientEntityId: id, entityType, operation: 'import',
    schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: {},
  }));
}

describe('regression: a receipt writes the mapping whenever it carries serverVersion', () => {
  it('no id at all: the mapping exists with syncId null, so the row reads as imported', async () => {
    const store = createMemoryLocalFirstStore();
    await appendImport(store, 'usage', USAGE);
    await coordinatorFor(store, (batch) => batch.events.map((e) => ({ eventId: e.eventId, status: 'accepted', serverVersion: 1 }))).synchronize(BOUND);
    const mapping = await store.read((tx) => tx.mapping('usage', USAGE, BOUND));
    expect(mapping).toMatchObject({ syncId: null, serverVersion: 1 });
    expect(mapping!.serverId).toBeUndefined();
    expect(isImported(mapping)).toBe(true);
  });

  it('a UUID serverId (mirror row) stays serverId text with syncId null', async () => {
    const store = createMemoryLocalFirstStore();
    await appendImport(store, 'usage', USAGE);
    await coordinatorFor(store, (batch) => batch.events.map((e) => ({ eventId: e.eventId, status: 'accepted', serverId: MIRROR_UUID, serverVersion: 1 }))).synchronize(BOUND);
    expect(await store.read((tx) => tx.mapping('usage', USAGE, BOUND))).toMatchObject({ syncId: null, serverId: MIRROR_UUID });
  });

  it('syncId wins over serverId, and both fields are written', async () => {
    const store = createMemoryLocalFirstStore();
    await appendImport(store, 'ticket', TICKET);
    await coordinatorFor(store, (batch) => batch.events.map((e) => ({ eventId: e.eventId, status: 'accepted', syncId: 70776, serverVersion: 1 }))).synchronize(BOUND);
    expect(await store.read((tx) => tx.mapping('ticket', TICKET, BOUND))).toMatchObject({ syncId: 70776, serverId: '70776' });
  });

  it('no serverVersion: no mapping (the server did not say it holds the row)', async () => {
    const store = createMemoryLocalFirstStore();
    await appendImport(store, 'ticket', TICKET);
    await coordinatorFor(store, (batch) => batch.events.map((e) => ({ eventId: e.eventId, status: 'dependency_pending' }))).synchronize(BOUND);
    expect(await store.read((tx) => tx.mapping('ticket', TICKET, BOUND))).toBeUndefined();
  });
});

describe('regression: the HTTP transport accepts numeric ids', () => {
  const push = async (row: Record<string, unknown>): Promise<SyncReceipt> => {
    const transport = createHttpSyncTransport({
      baseUrl: 'https://builderforce.test',
      fetch: async (): Promise<HttpSyncResponse> => ({
        ok: true,
        status: 200,
        json: async () => [{ eventId: 'evt-1', status: 'accepted', receivedAt: AT, serverVersion: 1, ...row }],
      }),
    });
    const [receipt] = await transport.push({ protocolVersion: 1, deviceId: 'd', destination: BOUND, events: [] } as unknown as SyncPushBatch);
    return receipt!;
  };

  it('a numeric syncId is kept', async () => {
    expect(await push({ syncId: 61651 })).toMatchObject({ syncId: 61651 });
    expect(await push({ syncId: '61651' })).toMatchObject({ syncId: 61651 });
  });

  it('a numeric serverId is no longer dropped: it arrives as text', async () => {
    expect(await push({ serverId: 501 })).toMatchObject({ serverId: '501' });
  });

  it('a non-id syncId is ignored, a text serverId is kept as is', async () => {
    const receipt = await push({ syncId: 'abc', serverId: MIRROR_UUID });
    expect(receipt.syncId).toBeUndefined();
    expect(receipt.serverId).toBe(MIRROR_UUID);
  });
});

describe('regression: an explicit syncId: null (a Brain run step) is never re-derived from serverId', () => {
  const STEP = '33333333-3333-4333-8333-333333333333';

  it('the transport keeps the explicit null', async () => {
    const transport = createHttpSyncTransport({
      baseUrl: 'https://builderforce.test',
      fetch: async (): Promise<HttpSyncResponse> => ({
        ok: true,
        status: 200,
        json: async () => [{ eventId: 'evt-1', status: 'accepted', receivedAt: AT, serverVersion: 1, syncId: null, serverId: '5' }],
      }),
    });
    const [receipt] = await transport.push({ protocolVersion: 1, deviceId: 'd', destination: BOUND, events: [] } as unknown as SyncPushBatch);
    expect(receipt).toMatchObject({ syncId: null, serverId: '5' });
  });

  it('a push receipt with syncId: null writes syncId null, serverId text kept', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact((tx) => tx.append({
      idempotencyKey: `message:${STEP}`, clientEntityId: STEP, entityType: 'message', operation: 'import',
      schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: {},
    }));
    await coordinatorFor(store, (batch) => batch.events.map((e) => ({ eventId: e.eventId, status: 'accepted', syncId: null, serverId: '5', serverVersion: 1 }))).synchronize(BOUND);
    expect(await store.read((tx) => tx.mapping('message', STEP, BOUND))).toMatchObject({ syncId: null, serverId: '5' });
  });
});

describe('regression: pull — the mapping holds the server keys, the stored record does not', () => {
  const PULLED = '44444444-4444-4444-8444-444444444444';
  const STEP = '55555555-5555-4555-8555-555555555555';

  const pulledRow = (id: string, entityType: string, keys: Record<string, unknown>) => ({
    id, entityType, schemaVersion: 1, version: 3, destination: BOUND, occurredAt: AT, updatedAt: AT, payload: { title: 'x' }, ...keys,
  });

  it('syncId lands on the mapping and is stripped from the record', async () => {
    const store = createMemoryLocalFirstStore();
    const policy = createPlatformPolicy();
    policy.set({ synchronize: true });
    const coordinator = createSyncCoordinator({
      store, policy, deviceId: 'd', lease: { run: (_owner, work) => work() },
      transport: {
        async push() { return []; },
        async pull() {
          return { records: [
            pulledRow(PULLED, 'ticket', { syncId: 501, serverId: '501' }),
            pulledRow(STEP, 'message', { syncId: null, serverId: '5' }),
          ] as never[] };
        },
      },
    });
    await coordinator.synchronize(BOUND);
    const record = await store.read((tx) => tx.get('ticket', PULLED));
    expect(record).toBeDefined();
    expect(record).not.toHaveProperty('syncId');
    expect(record).not.toHaveProperty('serverId');
    expect(await store.read((tx) => tx.mapping('ticket', PULLED, BOUND))).toMatchObject({ syncId: 501, serverId: '501', serverVersion: 3 });
    // The pulled step's explicit null is kept: its id is not message 5.
    expect(await store.read((tx) => tx.mapping('message', STEP, BOUND))).toMatchObject({ syncId: null, serverId: '5' });
  });
});
