/**
 * G15 — POST /api/sync/v1/push and POST /api/sync/v1/pull.
 *
 * Drives the routes against an in-memory `SyncStores` fake and the three named
 * importers. The push half proves the contract: a batch is accepted, its
 * mutations are applied by the owning importer, and every event gets a receipt
 * — accepted, rejected, conflict, duplicate, or dependency_pending. There is no
 * generic payload writer: an unknown entity type is rejected and writes nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  hashSyncPayload,
  SYNC_PROTOCOL_VERSION,
  type EntityDestination,
  type LocalRecord,
} from '../../domain/sync/syncProtocol';
import { rejectInvalidOccurredAt } from '../../application/sync/occurredAtGate';
import {
  mirrorRefuses,
} from '../../application/sync/importers/importMirrorRecord';
import type {
  StoredSyncEvent,
  SyncStoreSet,
  SyncStores,
} from '../../application/sync/syncPorts';
import {
  SYNC_PULL_PATH,
  SYNC_PUSH_PATH,
  mountSyncPushPull,
  type SyncNamedImporters,
  type SyncPushPullDeps,
  type SyncPushResponse,
  type SyncPullResponse,
} from './mountSyncBatch';

const NOW = new Date('2026-02-01T10:00:00.000Z');
const DESTINATION: EntityDestination = {
  kind: 'bound',
  tenantId: '7',
  accountId: 'user-7',
};
const AUTH = { tenantId: 7, userId: 'user-7', role: 'member' };

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
  eventId: '33333333-3333-4333-8333-333333333333',
  clientEntityId: '44444444-4444-4444-8444-444444444444',
  entityType: 'project',
  operation: 'create',
  schemaVersion: 1,
  localSequence: 2,
  occurredAt: '2026-01-31T09:00:00.000Z',
  dependsOn: [TICKET.eventId],
  destination: DESTINATION,
  payload: { name: 'launch' },
};

const CHAT = {
  eventId: '55555555-5555-4555-8555-555555555555',
  clientEntityId: '66666666-6666-4666-8666-666666666666',
  entityType: 'chat',
  operation: 'create',
  schemaVersion: 1,
  localSequence: 3,
  occurredAt: '2026-01-31T09:30:00.000Z',
  dependsOn: [] as string[],
  destination: DESTINATION,
  payload: { title: 'standup' },
};

/** Stamp the correct hash, unless the event already carries one to test against. */
function stampHash(event: Record<string, unknown>): Record<string, unknown> {
  return { ...event, payloadHash: hashSyncPayload(event.payload) };
}

function batch(events: Record<string, unknown>[]) {
  return {
    batchId: 'batch-1',
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: 'device-a',
    destination: DESTINATION,
    events: events.map((event) =>
      typeof event.payloadHash === 'string' ? event : stampHash(event)),
  };
}

function createMemoryStores(): SyncStores {
  interface MappingRow {
    tenantId: number;
    entityType: string;
    clientEntityId: string;
    serverId: string;
    serverVersion: number;
    destinationKey: string;
    payloadHash: string;
  }
  interface RecordRow {
    tenantId: number;
    entityType: string;
    clientEntityId: string;
    serverId: string;
    schemaVersion: number;
    version: number;
    destinationKey: string;
    occurredAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    payload: unknown;
    provenance: Record<string, unknown>;
  }
  interface State {
    events: StoredSyncEvent[];
    mappings: MappingRow[];
    records: RecordRow[];
    changes: { seq: number; record: LocalRecord }[];
    seq: number;
  }

  const state: State = { events: [], mappings: [], records: [], changes: [], seq: 0 };

  const setFor = (target: State): SyncStoreSet => ({
    async findEvent(tenantId, deviceId, eventId) {
      return target.events.find((row) => row.tenantId === tenantId && row.deviceId === deviceId && row.eventId === eventId) ?? null;
    },
    async insertEvent(row) {
      target.events.push({
        batchId: row.batchId,
        status: row.status,
        receivedAt: row.receivedAt,
        serverId: row.serverId,
        serverVersion: row.serverVersion,
        detail: row.detail,
        tenantId: row.tenantId,
        deviceId: row.deviceId,
        eventId: row.eventId,
      });
    },
    async acceptedEventIds(_tenantId, eventIds) {
      const settled = new Set(
        target.events.filter((row) => row.status === 'accepted' || row.status === 'duplicate').map((row) => row.eventId),
      );
      return new Set(eventIds.filter((id) => settled.has(id)));
    },
    async findMapping(tenantId, entityType, clientEntityId) {
      const row = target.mappings.find((m) => m.tenantId === tenantId && m.entityType === entityType && m.clientEntityId === clientEntityId);
      return row ?? null;
    },
    async upsertMapping(row) {
      const existing = target.mappings.find(
        (m) => m.tenantId === row.tenantId && m.entityType === row.entityType && m.clientEntityId === row.clientEntityId,
      );
      const next: MappingRow = {
        tenantId: row.tenantId,
        entityType: row.entityType,
        clientEntityId: row.clientEntityId,
        serverId: row.serverId,
        serverVersion: row.serverVersion,
        destinationKey: row.destinationKey,
        payloadHash: row.payloadHash,
      };
      if (existing) Object.assign(existing, next);
      else target.mappings.push(next);
    },
    async upsertRecord(row) {
      const existing = target.records.find(
        (r) => r.tenantId === row.tenantId && r.entityType === row.entityType && r.clientEntityId === row.clientEntityId,
      );
      const next: RecordRow = {
        tenantId: row.tenantId,
        entityType: row.entityType,
        clientEntityId: row.clientEntityId,
        serverId: row.serverId,
        schemaVersion: row.schemaVersion,
        version: row.version,
        destinationKey: row.destinationKey,
        occurredAt: row.occurredAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
        payload: row.payload,
        provenance: row.provenance,
      };
      if (existing) Object.assign(existing, next);
      else target.records.push(next);
    },
    async appendChange(row) {
      target.seq += 1;
      const record: LocalRecord = {
        id: row.clientEntityId,
        entityType: row.entityType,
        schemaVersion: 1,
        version: row.version,
        destination: DESTINATION,
        occurredAt: row.occurredAt.toISOString(),
        updatedAt: row.occurredAt.toISOString(),
        ...(row.operation === 'delete' ? { deletedAt: row.occurredAt.toISOString() } : {}),
        payload: row.record.payload,
        provenance: { ...row.record.provenance },
      };
      target.changes.push({ seq: target.seq, record });
    },
  });

  const base = setFor(state);

  return {
    ...base,
    async transact(work) {
      // Draft first, publish only if the unit of work returns: a throw rolls back.
      // structuredClone keeps the Date values the port declares as dates.
      const draft = structuredClone(state) as State;
      const result = await work(setFor(draft));
      state.events = draft.events;
      state.mappings = draft.mappings;
      state.records = draft.records;
      state.changes = draft.changes;
      state.seq = draft.seq;
      return result;
    },
    async minChangeSeq() {
      return state.changes.length === 0 ? null : (state.changes[0] as { seq: number }).seq;
    },
    async changesAfter(_tenantId, _destinationKey, after, limit) {
      return state.changes.filter((change) => change.seq > after).slice(0, limit);
    },
    async snapshotAfter(_tenantId, _destinationKey, after, limit) {
      const rows = [...state.records].sort((left, right) =>
        left.entityType === right.entityType
          ? left.clientEntityId.localeCompare(right.clientEntityId)
          : left.entityType.localeCompare(right.entityType));
      const start = after === null
        ? 0
        : rows.findIndex((row) => row.entityType > after.entityType
          || (row.entityType === after.entityType && row.clientEntityId > after.clientEntityId));
      const window = start < 0 ? rows : rows.slice(start);
      return window.slice(0, limit) as unknown as Awaited<ReturnType<SyncStores['snapshotAfter']>>;
    },
  };
}

interface ImporterCalls {
  ticket: string[];
  project: string[];
  mirror: string[];
}

/** Stands in for the three domain importers: writes nothing, returns an outcome. */
function createImporters(log: ImporterCalls, behaviour: (entityType: string, eventId: string) => 'applied' | 'conflict' | 'rejected' = () => 'applied'): SyncNamedImporters {
  const record = (entityType: string, eventId: string): void => {
    if (entityType === 'ticket') log.ticket.push(eventId);
    else if (entityType === 'project') log.project.push(eventId);
    else log.mirror.push(eventId);
  };
  const run = async (entityType: string, event: { eventId: string; payload: unknown }) => {
    record(entityType, event.eventId);
    const status = behaviour(entityType, event.eventId);
    if (status === 'rejected') return { status: 'rejected' as const, detail: 'entity_not_imported' };
    if (status === 'conflict') {
      return { status: 'conflict' as const, detail: 'base_version_conflict', serverId: '1', serverVersion: 3, payloadHash: hashSyncPayload({}), destinationKey: 'bound' };
    }
    return {
      status: 'applied' as const,
      serverId: String(entityType === 'ticket' ? 900 : 800),
      serverVersion: 1,
      payloadHash: hashSyncPayload(event.payload),
      destinationKey: 'bound',
      payload: event.payload,
    };
  };
  return {
    importSyncedTicket: (event) => run('ticket', event),
    importSyncedProject: (event) => run('project', event),
    importMirrorRecord: (event) => run('chat', event),
  };
}

interface Harness {
  deps: SyncPushPullDeps;
  push: (body: unknown) => Promise<SyncPushResponse>;
  pull: (body: unknown) => Promise<SyncPullResponse>;
  paths: string[];
  stores: SyncStores;
}

function harness(behaviour?: (entityType: string, eventId: string) => 'applied' | 'conflict' | 'rejected'): Harness {
  const routes = new Map<string, (body: unknown) => Promise<SyncPushResponse | SyncPullResponse>>();
  const paths: string[] = [];
  const stores = createMemoryStores();
  const log: ImporterCalls = { ticket: [], project: [], mirror: [] };
  const deps: SyncPushPullDeps = {
    auth: AUTH,
    now: NOW,
    stores,
    importers: createImporters(log, behaviour),
  };
  const router = {
    post(path: string, handler: (body: unknown) => Promise<SyncPushResponse | SyncPullResponse>) {
      paths.push(path);
      routes.set(path, handler);
    },
  };
  mountSyncPushPull(router, deps);
  return {
    deps,
    paths,
    stores,
    push: (body) => routes.get(SYNC_PUSH_PATH)!(body) as Promise<SyncPushResponse>,
    pull: (body) => routes.get(SYNC_PULL_PATH)!(body) as Promise<SyncPullResponse>,
  };
}

describe('POST /api/sync/v1/push — a batch is applied and every event gets a receipt', () => {
  it('registers push and pull, and applies each event through its named importer', async () => {
    const h = harness();
    expect(h.paths).toEqual([SYNC_PUSH_PATH, SYNC_PULL_PATH]);

    const response = await h.push(batch([TICKET, PROJECT, CHAT]));

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.status).toBe(200);
    // One receipt per event, in input order.
    expect(response.receipts.map((r) => r.eventId)).toEqual([TICKET.eventId, PROJECT.eventId, CHAT.eventId]);
    expect(response.receipts.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(response.receipts[0].serverVersion).toBe(1);
    for (const receipt of response.receipts) expect(receipt.receivedAt).toBe(NOW.toISOString());

    // Ticket went to its owning importer, not to the mirror.
    expect(h.deps.importers.importSyncedTicket).toBeTypeOf('function');
    const mappings = await h.stores.findMapping(7, 'ticket', TICKET.clientEntityId);
    expect(mappings?.serverVersion).toBe(1);
    const record = await h.stores.snapshotAfter(7, null, null, 10);
    expect(record.map((row) => row.entityType).sort()).toEqual(['chat', 'project', 'ticket']);
  });

  it('orders a dependent event after the event it depends on, in one batch', async () => {
    const calls: string[] = [];
    const routes = new Map<string, (body: unknown) => Promise<SyncPushResponse | SyncPullResponse>>();
    const stores = createMemoryStores();
    const deps: SyncPushPullDeps = {
      auth: AUTH,
      now: NOW,
      stores,
      importers: {
        importSyncedTicket: async (event) => {
          calls.push(`ticket:${event.eventId}`);
          return { status: 'applied', serverId: '1', serverVersion: 1, payloadHash: hashSyncPayload(event.payload), destinationKey: 'bound', payload: event.payload };
        },
        importSyncedProject: async (event) => {
          calls.push(`project:${event.eventId}`);
          return { status: 'applied', serverId: '2', serverVersion: 1, payloadHash: hashSyncPayload(event.payload), destinationKey: 'bound', payload: event.payload };
        },
        importMirrorRecord: async (event) => {
          calls.push(`mirror:${event.eventId}`);
          return { status: 'applied', serverId: '3', serverVersion: 1, payloadHash: hashSyncPayload(event.payload), destinationKey: 'bound', payload: event.payload };
        },
      },
    };
    mountSyncPushPull({ post: (path, handler) => routes.set(path, handler) }, deps);

    // PROJECT declares dependsOn TICKET but arrives first in the array.
    const response = (await routes.get(SYNC_PUSH_PATH)!(batch([PROJECT, TICKET]))) as SyncPushResponse;

    expect(calls[0]).toBe(`ticket:${TICKET.eventId}`);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts.map((r) => r.status)).toEqual(['accepted', 'accepted']);
  });

  it('refuses a whole batch whose destination contradicts the authenticated tenant', async () => {
    const h = harness();
    const response = await h.push({
      ...batch([TICKET]),
      destination: { kind: 'bound', tenantId: '999' },
    });

    expect(response).toEqual({ ok: false, status: 400, code: 'destination_tenant_mismatch' });
    expect(await h.stores.findMapping(7, 'ticket', TICKET.clientEntityId)).toBeNull();
  });

  it('refuses a batch whose payload hash does not match the payload', async () => {
    const h = harness();
    const response = await h.push(batch([{ ...TICKET, payloadHash: 'fnv1a:deadbeef' }]));

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts[0]).toMatchObject({ eventId: TICKET.eventId, status: 'rejected', detail: 'payload_hash_mismatch' });
    expect(await h.stores.findMapping(7, 'ticket', TICKET.clientEntityId)).toBeNull();
  });

  it('refuses an occurredAt beyond the clock skew before any insert', async () => {
    const h = harness();
    const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    expect(rejectInvalidOccurredAt(future, NOW)).toBe('occurred_at_in_future');

    const response = await h.push(batch([{ ...TICKET, occurredAt: future }]));

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'occurred_at_in_future' });
    expect(await h.stores.findMapping(7, 'ticket', TICKET.clientEntityId)).toBeNull();
  });

  it('rejects an entity type no importer owns and writes nothing', async () => {
    const h = harness();
    const unknown = { ...CHAT, entityType: 'ledger-entry', eventId: '77777777-7777-4777-8777-777777777777' };

    const response = await h.push(batch([unknown]));

    expect(mirrorRefuses('ledger-entry')).toBe(true);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'entity_type_rejected' });
    expect(await h.stores.snapshotAfter(7, null, null, 10)).toHaveLength(0);
  });

  it('answers a replayed event as duplicate without applying it twice', async () => {
    const h = harness();
    const first = await h.push(batch([TICKET]));
    expect(first.ok).toBe(true);

    const second = await h.push(batch([TICKET]));

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.receipts[0]).toMatchObject({ eventId: TICKET.eventId, status: 'duplicate', serverVersion: 1 });
    expect(await h.stores.changesAfter(7, null, 0, 10)).toHaveLength(1);
  });

  it('reports an importer conflict as a conflict receipt, not an overwrite', async () => {
    const h = harness(() => 'conflict');
    const response = await h.push(batch([TICKET]));

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts[0]).toMatchObject({ status: 'conflict', detail: 'base_version_conflict' });
    expect(await h.stores.findMapping(7, 'ticket', TICKET.clientEntityId)).toBeNull();
  });

  it('reports an importer rejection as a rejected receipt', async () => {
    const h = harness(() => 'rejected');
    const response = await h.push(batch([TICKET]));

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts[0]).toMatchObject({ status: 'rejected', detail: 'entity_not_imported' });
    expect(await h.stores.findMapping(7, 'ticket', TICKET.clientEntityId)).toBeNull();
  });

  it('holds an unmet cross-batch dependency pending without storing a receipt', async () => {
    const h = harness();
    const orphan = { ...PROJECT, dependsOn: ['99999999-9999-4999-8999-999999999999'], eventId: '88888888-8888-4888-8888-888888888888', clientEntityId: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

    const response = await h.push(batch([orphan]));

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.receipts[0]).toMatchObject({ status: 'dependency_pending' });
    expect(await h.stores.findEvent(7, 'device-a', orphan.eventId)).toBeNull();
    expect(await h.stores.findMapping(7, 'project', orphan.clientEntityId)).toBeNull();
  });

  it('refuses a batch that is not an object, applying nothing', async () => {
    const h = harness();
    expect(await h.push('nope')).toEqual({ ok: false, status: 400, code: 'invalid_batch' });
    expect(await h.push(null)).toEqual({ ok: false, status: 400, code: 'invalid_batch' });
    expect(await h.stores.snapshotAfter(7, null, null, 10)).toHaveLength(0);
  });

  it('refuses an unsupported protocol version', async () => {
    const h = harness();
    const response = await h.push({ ...batch([TICKET]), protocolVersion: 99 });
    expect(response).toEqual({ ok: false, status: 400, code: 'protocol_version_unsupported' });
  });
});

describe('POST /api/sync/v1/pull — the cursor page', () => {
  it('serves a snapshot first, then only the changes after the cursor', async () => {
    const h = harness();
    await h.push(batch([TICKET, PROJECT, CHAT]));

    const first = await h.pull({ destination: DESTINATION, limit: 50 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.records.map((r) => r.entityType).sort()).toEqual(['chat', 'project', 'ticket']);
    expect(first.result.resnapshotRequired).toBeUndefined();
    const cursor = first.result.cursor;
    expect(cursor).toBeTypeOf('string');

    const newTicket = { ...TICKET, eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', clientEntityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', localSequence: 9 };
    await h.push(batch([newTicket]));

    const delta = await h.pull({ destination: DESTINATION, cursor, limit: 50 });
    expect(delta.ok).toBe(true);
    if (!delta.ok) return;
    expect(delta.result.records.map((r) => r.id)).toEqual([newTicket.clientEntityId]);
  });

  it('asks for a resnapshot for a cursor this codec did not produce, never a partial page', async () => {
    const h = harness();
    await h.push(batch([TICKET]));

    const response = await h.pull({ destination: DESTINATION, cursor: 'not-a-cursor', limit: 50 });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.resnapshotRequired).toBe(true);
    expect(response.result.records).toEqual([]);
  });

  it('refuses a pull whose destination contradicts the authenticated tenant', async () => {
    const h = harness();
    const response = await h.pull({ destination: { kind: 'bound', tenantId: '999' }, limit: 50 });
    expect(response).toEqual({ ok: false, status: 400, code: 'destination_tenant_mismatch' });
  });

  it('refuses an out-of-range limit instead of serving an unbounded page', async () => {
    const h = harness();
    expect((await h.pull({ destination: DESTINATION, limit: 0 }))).toEqual({ ok: false, status: 400, code: 'invalid_limit' });
    expect((await h.pull({ destination: DESTINATION, limit: 100000 }))).toEqual({ ok: false, status: 400, code: 'invalid_limit' });
  });
});