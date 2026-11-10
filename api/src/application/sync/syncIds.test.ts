/**
 * typed-entity-ids §4 (server, Phase B): the mapping dual-writes `server_id` text and `sync_id`;
 * receipts and pulled records carry `syncId` beside `serverId`; readers coalesce
 * `sync_id` with the parsed `server_id`; mirror / usage / step rows get no SyncId.
 */

import { describe, expect, it } from 'vitest';
import { STEP_ID_FLOOR } from '../../infrastructure/database/schema/canvas';
import { SYNC_PROTOCOL_VERSION, hashSyncPayload, type EntityDestination } from '../../domain/sync/syncProtocol';
import { createMemorySyncStores } from './__fixtures__/memorySyncStores';
import { handleSyncPull } from './handleSyncPull';
import { handleSyncPush } from './handleSyncPush';
import { mappedServerKey, syncIdOf } from './syncIds';
import type { SyncMutationImporter, SyncNamedImporters } from './syncPorts';

const NOW = new Date('2026-11-09T10:00:00.000Z');
const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer' };
const DESTINATION: EntityDestination = { kind: 'bound', tenantId: '7', repository: 'repo-a' };
const TICKET = 'aaaaaaa1-0000-4000-8000-000000000000';
const MIRROR = 'aaaaaaa2-0000-4000-8000-000000000000';
const STEP = 'aaaaaaa3-0000-4000-8000-000000000000';
const STEP_SERVER_ID = String(STEP_ID_FLOOR + 5);

describe('syncIdOf', () => {
  it('is the integer server key, and null for a UUID, a "kind:ref", or a run step', () => {
    expect(syncIdOf('ticket', '42')).toBe(42);
    expect(syncIdOf('message', '77')).toBe(77);
    expect(syncIdOf('usage', TICKET)).toBeNull();
    expect(syncIdOf('ticket', 'roadmap:abc')).toBeNull();
    expect(syncIdOf('ticket', '0')).toBeNull();
    expect(syncIdOf('message', STEP_SERVER_ID)).toBeNull();
    expect(syncIdOf('ticket', null)).toBeNull();
  });
});

describe('mappedServerKey (the coalescing reader)', () => {
  it('reads sync_id first', () => {
    expect(mappedServerKey({ serverId: '9', syncId: 5 })).toBe(5);
  });

  it('falls back to the parsed server_id when sync_id is null or absent (a row the old Worker wrote)', () => {
    expect(mappedServerKey({ serverId: '9', syncId: null })).toBe(9);
    expect(mappedServerKey({ serverId: '9' })).toBe(9);
    // A step keeps its key in server_id only: the importer still finds the step.
    expect(mappedServerKey({ serverId: STEP_SERVER_ID, syncId: null })).toBe(STEP_ID_FLOOR + 5);
  });

  it('is null when neither holds an integer key', () => {
    expect(mappedServerKey({ serverId: MIRROR, syncId: null })).toBeNull();
  });
});

/** Ticket → '42'; a step message → its step id; everything else (mirror) → its own UUID. */
const apply: SyncMutationImporter = async (event, ctx, stores) => {
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  const serverId = event.entityType === 'ticket' ? '42' : event.entityType === 'message' ? STEP_SERVER_ID : event.clientEntityId;
  return {
    status: 'applied',
    serverId: mapping?.serverId ?? serverId,
    serverVersion: (mapping?.serverVersion ?? 0) + 1,
    payloadHash: hashSyncPayload(event.payload),
    destinationKey: ctx.destinationKey,
    payload: event.payload,
  };
};
const IMPORTERS: SyncNamedImporters = {
  importSyncedTicket: apply,
  importSyncedProject: apply,
  importSyncedChat: apply,
  importSyncedMessage: apply,
  importSyncedUsage: apply,
  importSyncedChatTicketLink: apply,
  importMirrorRecord: apply,
};

let counter = 0;
function event(clientEntityId: string, entityType: string) {
  counter += 1;
  const payload = { title: `t-${counter}` };
  return {
    eventId: `${String(counter).padStart(8, '0')}-1111-4000-8000-000000000000`,
    clientEntityId,
    entityType,
    operation: 'create',
    schemaVersion: 1,
    localSequence: counter,
    occurredAt: NOW.toISOString(),
    dependsOn: [],
    destination: DESTINATION,
    payload,
    payloadHash: hashSyncPayload(payload),
  };
}

function harness() {
  const stores = createMemorySyncStores({ importers: IMPORTERS, now: () => NOW });
  const deps = { auth: AUTH, now: NOW, stores };
  const push = (events: Array<ReturnType<typeof event>>) => handleSyncPush({
    batchId: `b-${counter}`,
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: 'device-a',
    destination: DESTINATION,
    events,
  }, deps);
  const pull = (body: Record<string, unknown>) => handleSyncPull(body, deps);
  return { stores, push, pull };
}

describe('receipts and pulled records carry syncId', () => {
  it('answers syncId beside serverId for an integer key, and none for mirror or step records', async () => {
    const h = harness();
    const ticket = event(TICKET, 'ticket');
    const mirror = event(MIRROR, 'execution');
    const step = event(STEP, 'message');
    const pushed = await h.push([ticket, mirror, step]);
    expect(pushed.ok).toBe(true);
    if (!pushed.ok) return;
    const [ticketReceipt, mirrorReceipt, stepReceipt] = pushed.receipts;
    expect(ticketReceipt).toMatchObject({ status: 'accepted', serverId: '42', syncId: 42 });
    expect(mirrorReceipt).toMatchObject({ status: 'accepted', serverId: MIRROR });
    expect(mirrorReceipt).not.toHaveProperty('syncId');
    expect(stepReceipt).toMatchObject({ status: 'accepted', serverId: STEP_SERVER_ID });
    expect(stepReceipt).not.toHaveProperty('syncId');

    // The mapping dual-writes: text for older devices, the integer key for new ones.
    const mappings = h.stores.state().mappings;
    expect(mappings.find((m) => m.clientEntityId === TICKET)).toMatchObject({ serverId: '42', syncId: 42 });
    expect(mappings.find((m) => m.clientEntityId === MIRROR)).toMatchObject({ serverId: MIRROR, syncId: null });
    expect(mappings.find((m) => m.clientEntityId === STEP)).toMatchObject({ serverId: STEP_SERVER_ID, syncId: null });

    // A replay answers the same syncId the first delivery did.
    const replay = await h.push([ticket]);
    expect(replay.ok && replay.receipts[0]).toMatchObject({ status: 'duplicate', serverId: '42', syncId: 42 });
  });

  it('sends syncId and serverId on snapshot and delta records (pull never sent the id before)', async () => {
    const h = harness();
    await h.push([event(TICKET, 'ticket'), event(MIRROR, 'execution')]);
    const snapshot = await h.pull({ destination: DESTINATION, limit: 50 });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const byId = new Map(snapshot.result.records.map((r) => [r.id, r as unknown as Record<string, unknown>]));
    expect(byId.get(TICKET)).toMatchObject({ syncId: 42, serverId: '42' });
    expect(byId.get(MIRROR)).not.toHaveProperty('syncId');
    expect(byId.get(MIRROR)).not.toHaveProperty('serverId');

    const updated = { ...event(TICKET, 'ticket'), operation: 'update', baseVersion: 1 };
    await h.push([updated]);
    const delta = await h.pull({ destination: DESTINATION, cursor: snapshot.result.cursor, limit: 50 });
    expect(delta.ok && delta.result.records).toEqual([expect.objectContaining({ id: TICKET, syncId: 42, serverId: '42' })]);
  });
});
