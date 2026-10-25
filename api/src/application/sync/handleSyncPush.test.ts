/**
 * G15/G16/G25 — `handleSyncPush` against the in-memory `SyncStores`.
 *
 * Proves the push contract end to end: one receipt per event in input order;
 * accepted mutations go through the named importer inside ONE unit of work with
 * the mapping, projection, change row and receipt; a replay is answered from
 * its receipt before any other check (and a different payload under a used
 * event id is refused); a lost receipt race rolls the loser back; refusals and
 * dependency holds write nothing; the destination is bound to the caller's
 * tenant and project, under the one first-bind policy.
 */

import { describe, expect, it } from 'vitest';
import {
  SYNC_PROTOCOL_VERSION,
  destinationKey,
  hashSyncPayload,
  type EntityDestination,
} from '../../domain/sync/syncProtocol';
import { createMemorySyncStores, type MemorySyncStores } from './__fixtures__/memorySyncStores';
import { handleSyncPush, type SyncPushDeps } from './handleSyncPush';
import type { BoundedImportOutcome, SyncNamedImporters, SyncReferenceReader, SyncStoreSet } from './syncPorts';

const NOW = new Date('2026-02-01T10:00:00.000Z');
const DESTINATION: EntityDestination = { kind: 'bound', tenantId: '7', accountId: 'user-7' };
const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer' };

const TICKET = {
  eventId: '11111111-1111-4111-8111-111111111111',
  clientEntityId: '22222222-2222-4222-8222-222222222222',
  entityType: 'ticket',
  operation: 'create',
  schemaVersion: 1,
  localSequence: 1,
  occurredAt: '2026-01-31T08:00:00.000Z',
  dependsOn: [] as string[],
  destination: DESTINATION,
  payload: { title: 'ship it' },
};

const PROJECT = {
  ...TICKET,
  eventId: '33333333-3333-4333-8333-333333333333',
  clientEntityId: '44444444-4444-4444-8444-444444444444',
  entityType: 'project',
  localSequence: 2,
  dependsOn: [TICKET.eventId],
  payload: { name: 'launch' },
};

const CHAT = {
  ...TICKET,
  eventId: '55555555-5555-4555-8555-555555555555',
  clientEntityId: '66666666-6666-4666-8666-666666666666',
  entityType: 'chat',
  localSequence: 3,
  payload: { title: 'standup' },
};

function stamp(event: Record<string, unknown>): Record<string, unknown> {
  return typeof event.payloadHash === 'string' ? event : { ...event, payloadHash: hashSyncPayload(event.payload) };
}

function batch(events: Record<string, unknown>[], destination: EntityDestination = DESTINATION) {
  return {
    batchId: 'batch-1',
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: 'device-a',
    destination,
    events: events.map(stamp),
  };
}

type Behaviour = 'applied' | 'conflict' | 'rejected' | 'pending';

interface ImporterLog {
  calls: string[];
  txSeen: SyncStoreSet[];
  ctxKeys: string[];
}

function importers(log: ImporterLog, behaviour: (entityType: string) => Behaviour = () => 'applied'): SyncNamedImporters {
  const run = (entityType: string) => async (
    event: { eventId: string; payload: unknown },
    ctx: { destinationKey: string },
    stores: SyncStoreSet,
  ): Promise<BoundedImportOutcome> => {
    log.calls.push(`${entityType}:${event.eventId}`);
    log.txSeen.push(stores);
    log.ctxKeys.push(ctx.destinationKey);
    const status = behaviour(entityType);
    if (status === 'rejected') return { status: 'rejected', detail: 'entity_not_imported' };
    if (status === 'pending') return { status: 'pending', detail: 'message_chat_pending' };
    if (status === 'conflict') {
      return { status: 'conflict', detail: 'base_version_conflict', serverId: '1', serverVersion: 3, payloadHash: 'fnv1a:0', destinationKey: 'k' };
    }
    return {
      status: 'applied',
      serverId: entityType === 'ticket' ? '900' : '800',
      serverVersion: 1,
      payloadHash: hashSyncPayload(event.payload),
      destinationKey: destinationKey(DESTINATION),
      payload: event.payload,
    };
  };
  return {
    importSyncedTicket: run('ticket'),
    importSyncedProject: run('project'),
    importSyncedChat: run('chat'),
    importSyncedMessage: run('message'),
    importSyncedUsage: run('usage'),
    importMirrorRecord: run('mirror'),
  };
}

function harness(options: {
  behaviour?: (entityType: string) => Behaviour;
  references?: Partial<SyncReferenceReader>;
  role?: string;
} = {}) {
  const log: ImporterLog = { calls: [], txSeen: [], ctxKeys: [] };
  const stores: MemorySyncStores = createMemorySyncStores({
    importers: importers(log, options.behaviour),
    references: options.references,
    now: () => NOW,
  });
  const deps: SyncPushDeps = { auth: { ...AUTH, role: options.role ?? AUTH.role }, now: NOW, stores };
  return { log, stores, push: (body: unknown) => handleSyncPush(body, deps) };
}

describe('handleSyncPush — a batch is applied and every event gets a receipt', () => {
  it('applies each event through its named importer and answers in input order', async () => {
    const h = harness();
    const response = await h.push(batch([TICKET, PROJECT, CHAT]));

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts.map((r) => r.eventId)).toEqual([TICKET.eventId, PROJECT.eventId, CHAT.eventId]);
    expect(response.receipts.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    for (const receipt of response.receipts) expect(receipt.receivedAt).toBe(NOW.toISOString());

    const state = h.stores.state();
    expect(state.events.map((e) => e.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(state.mappings).toHaveLength(3);
    expect(state.records).toHaveLength(3);
    expect(state.changes).toHaveLength(3);
    // The change record is client-reported history, actor from auth.
    expect(state.changes[0]?.record.provenance).toMatchObject({ actorId: 'user-7', source: 'imported', evidence: 'client-reported' });
  });

  it('hands the importer the unit of work’s own stores (one transaction per event)', async () => {
    const h = harness();
    await h.push(batch([TICKET, CHAT]));
    expect(h.log.txSeen).toHaveLength(2);
    expect(h.log.txSeen[0]).not.toBe(h.log.txSeen[1]);
    expect(h.stores.commits()).toBe(2);
  });

  it('orders a dependent event after the event it depends on', async () => {
    const h = harness();
    await h.push(batch([PROJECT, TICKET]));
    expect(h.log.calls).toEqual([`ticket:${TICKET.eventId}`, `project:${PROJECT.eventId}`]);
  });

  it('binds an omitted tenant to the caller’s, so both spellings share one key', async () => {
    const h = harness();
    const omitted: EntityDestination = { kind: 'bound', accountId: 'user-7' };
    const response = await h.push(batch([{ ...TICKET, destination: omitted }], omitted));
    expect(response.ok && response.receipts[0]?.status).toBe('accepted');
    expect(h.log.ctxKeys).toEqual([destinationKey(DESTINATION)]);
  });

  it('refuses a destination that contradicts the authenticated tenant and writes nothing', async () => {
    const h = harness();
    const response = await h.push(batch([TICKET], { kind: 'bound', tenantId: '999' }));
    expect(response).toEqual({ ok: false, status: 400, code: 'destination_tenant_mismatch' });
    expect(h.stores.state().events).toHaveLength(0);
  });

  it('refuses binding for a role without project write access (first-bind policy)', async () => {
    const h = harness({ role: 'viewer' });
    expect(await h.push(batch([TICKET]))).toEqual({ ok: false, status: 403, code: 'destination_bind_forbidden' });
  });
});

describe('handleSyncPush — replay and idempotency (G16)', () => {
  it('answers a replayed event as duplicate without applying it twice', async () => {
    const h = harness();
    await h.push(batch([TICKET]));
    const second = await h.push(batch([TICKET]));
    expect(second.ok && second.receipts[0]).toMatchObject({ status: 'duplicate', serverId: '900', serverVersion: 1 });
    expect(h.log.calls).toHaveLength(1);
    expect(h.stores.state().changes).toHaveLength(1);
  });

  it('looks the receipt up BEFORE the pre-insert refusals', async () => {
    const h = harness();
    await h.push(batch([TICKET]));
    // Same event, now flagged dead-letter by the client: still the stored answer.
    const replay = await h.push(batch([{ ...TICKET, deadLetter: { reason: 'x', at: NOW.toISOString() } }]));
    expect(replay.ok && replay.receipts[0]?.status).toBe('duplicate');
  });

  it('refuses a replay whose payload differs from the first delivery', async () => {
    const h = harness();
    await h.push(batch([TICKET]));
    const replay = await h.push(batch([{ ...TICKET, payload: { title: 'something else' } }]));
    expect(replay.ok && replay.receipts[0]).toMatchObject({ status: 'rejected', detail: 'event_payload_mismatch' });
    expect(h.log.calls).toHaveLength(1);
    expect(h.stores.state().mappings).toHaveLength(1);
  });

  it('answers a lost receipt race from the winner and rolls the loser back', async () => {
    const h = harness();
    await h.push(batch([TICKET]));
    const winner = { ...h.stores.state().events[0]! };
    // A second delivery that raced past the replay lookup.
    const outer = h.stores.findEvent;
    let calls = 0;
    h.stores.findEvent = async (...args) => (calls++ === 0 ? null : outer(...args));

    const raced = await h.push(batch([TICKET]));

    expect(raced.ok && raced.receipts[0]).toMatchObject({ status: 'duplicate', serverId: winner.serverId });
    expect(h.stores.rollbacks()).toBe(1);
    expect(h.stores.state().changes).toHaveLength(1);
  });

  it('replays a stored conflict as a conflict', async () => {
    const h = harness({ behaviour: () => 'conflict' });
    await h.push(batch([TICKET]));
    const replay = await h.push(batch([TICKET]));
    expect(replay.ok && replay.receipts[0]).toMatchObject({ status: 'conflict', detail: 'base_version_conflict' });
    expect(h.stores.state().mappings).toHaveLength(0);
  });
});

describe('handleSyncPush — refusals and holds write nothing', () => {
  it('refuses an occurredAt beyond the clock skew before any insert (G25)', async () => {
    const h = harness();
    const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    const response = await h.push(batch([{ ...TICKET, occurredAt: future }]));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'occurred_at_in_future' });
    expect(h.stores.commits()).toBe(0);
  });

  it('keeps an arbitrarily old occurredAt as client time, with server receivedAt', async () => {
    const h = harness();
    await h.push(batch([{ ...TICKET, occurredAt: '2019-03-04T08:15:00.000Z' }]));
    const [row] = h.stores.state().events;
    expect(row?.occurredAt.toISOString()).toBe('2019-03-04T08:15:00.000Z');
    expect(row?.receivedAt).toEqual(NOW);
  });

  it('refuses a payload hash that does not match the payload', async () => {
    const h = harness();
    const response = await h.push(batch([{ ...TICKET, payloadHash: 'fnv1a:deadbeef' }]));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'payload_hash_mismatch' });
  });

  it('refuses a non-UUID event id without a journal lookup', async () => {
    const h = harness();
    const response = await h.push(batch([{ ...TICKET, eventId: 'ticket:abc:v1' }]));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'event_id_invalid' });
  });

  it('refuses a dependency that is not an event id', async () => {
    const h = harness();
    const response = await h.push(batch([{ ...CHAT, dependsOn: ['audit-run:create:x'] }]));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'depends_on_invalid' });
  });

  it('rejects an entity type no importer owns', async () => {
    const h = harness();
    const response = await h.push(batch([{ ...CHAT, entityType: 'ledger-entry' }]));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'entity_type_rejected' });
    expect(h.log.calls).toHaveLength(0);
  });

  it('reports an importer rejection and stores no receipt', async () => {
    const h = harness({ behaviour: () => 'rejected' });
    const response = await h.push(batch([TICKET]));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'entity_not_imported' });
    expect(h.stores.state().events).toHaveLength(0);
  });

  it('holds an unmet cross-batch dependency pending without storing a receipt', async () => {
    const h = harness();
    const orphan = { ...CHAT, dependsOn: ['99999999-9999-4999-8999-999999999999'] };
    const response = await h.push(batch([orphan]));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'dependency_pending' });
    expect(h.stores.state().events).toHaveLength(0);
  });

  it('refuses an envelope that is not a batch, applying nothing', async () => {
    const h = harness();
    expect(await h.push('nope')).toEqual({ ok: false, status: 400, code: 'invalid_batch' });
    expect(await h.push(null)).toEqual({ ok: false, status: 400, code: 'invalid_batch' });
    expect(await h.push({ ...batch([TICKET]), protocolVersion: 99 })).toEqual({ ok: false, status: 400, code: 'protocol_version_unsupported' });
  });
});

describe('handleSyncPush — an importer whose parent has not landed', () => {
  it('answers dependency_pending and writes nothing, so the event stays retryable', async () => {
    const h = harness({ behaviour: () => 'pending' });
    const response = await h.push(batch([CHAT]));
    expect(response.ok && response.receipts.map((r) => [r.status, r.detail])).toEqual([['dependency_pending', 'message_chat_pending']]);
    const state = h.stores.state();
    expect(state.events).toHaveLength(0);
    expect(state.mappings).toHaveLength(0);
    expect(state.records).toHaveLength(0);
  });
});

describe('handleSyncPush — the destination project belongs to the tenant', () => {
  const PROJECT_UUID = '77777777-7777-4777-8777-777777777777';

  it('refuses a decimal project id the tenant does not own', async () => {
    const h = harness({ references: { projectInTenant: async () => false } });
    const destination: EntityDestination = { ...DESTINATION, projectId: '41' };
    expect(await h.push(batch([{ ...TICKET, destination }], destination)))
      .toEqual({ ok: false, status: 400, code: 'destination_project_invalid' });
  });

  it('accepts a decimal project id the tenant owns', async () => {
    const seen: Array<[number, number]> = [];
    const h = harness({ references: { projectInTenant: async (t, p) => { seen.push([t, p]); return true; } } });
    const destination: EntityDestination = { ...DESTINATION, projectId: '41' };
    const response = await h.push(batch([{ ...TICKET, destination }], destination));
    expect(response.ok && response.receipts[0]?.status).toBe('accepted');
    expect(seen).toEqual([[7, 41]]);
  });

  it('holds a batch whose project UUID is not mapped yet — retryable, nothing written', async () => {
    const h = harness();
    const destination: EntityDestination = { ...DESTINATION, projectId: PROJECT_UUID };
    const response = await h.push(batch([{ ...TICKET, destination }], destination));
    expect(response.ok && response.receipts[0]).toMatchObject({ status: 'dependency_pending', detail: 'destination_project_pending' });
    expect(h.stores.commits()).toBe(0);
  });

  it('binds a project UUID the same batch creates', async () => {
    const h = harness();
    const destination: EntityDestination = { ...DESTINATION, projectId: PROJECT_UUID };
    const response = await h.push(batch([{ ...PROJECT, dependsOn: [], clientEntityId: PROJECT_UUID, destination }], destination));
    expect(response.ok && response.receipts[0]?.status).toBe('accepted');
  });

  it('refuses a project id that is neither a server id nor a client UUID', async () => {
    const h = harness();
    const destination: EntityDestination = { ...DESTINATION, projectId: 'other-tenant-project' };
    expect(await h.push(batch([TICKET], destination))).toEqual({ ok: false, status: 400, code: 'destination_project_invalid' });
  });
});
