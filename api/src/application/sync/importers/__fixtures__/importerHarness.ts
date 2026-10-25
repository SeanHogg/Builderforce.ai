/**
 * The importer unit-test harness — the import context, a wire event, a store set
 * that refuses every write an importer must not make, a mapping row, and the
 * unit-of-work transaction double. Shared by every importer's tests.
 */

import { destinationKey, hashSyncPayload, type LocalEntityType } from '../../../../domain/sync/syncProtocol';
import type { Tx } from '../../../../infrastructure/database/connection';
import { fakeDb } from '../../../../../test/fakeDb';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../../syncPorts';

export const destination = { kind: 'bound' as const, tenantId: '7', accountId: 'user-1' };
export const boundKey = destinationKey(destination);
export const now = new Date('2026-10-18T00:00:00.000Z');

export function ctx(overrides: Partial<SyncImportContext> = {}): SyncImportContext {
  return {
    auth: { tenantId: 7, userId: 'user-1', role: 'member' },
    deviceId: 'device-1',
    destination,
    destinationKey: boundKey,
    now,
    resolveProjectId: async () => 3,
    resolveTaskId: async () => null,
    isTenantMember: async () => true,
    resolveOwnChatId: async (chatId) => chatId,
    ...overrides,
  };
}

export function event(partial: {
  entityType: LocalEntityType;
  operation: SyncEventInput['operation'];
  payload: unknown;
  clientEntityId?: string;
  baseVersion?: number;
  schemaVersion?: number;
}): SyncEventInput {
  return {
    eventId: 'evt-1',
    clientEntityId: partial.clientEntityId ?? '11111111-1111-4111-8111-111111111111',
    entityType: partial.entityType,
    operation: partial.operation,
    schemaVersion: partial.schemaVersion ?? 1,
    localSequence: 1,
    occurredAt: '2026-01-01T00:00:00.000Z',
    baseVersion: partial.baseVersion,
    dependsOn: [],
    destination,
    payload: partial.payload,
    payloadHash: hashSyncPayload(partial.payload),
  };
}

export function stores(mapping: SyncEntityMappingRow | null = null): SyncStoreSet & { writes: string[] } {
  const writes: string[] = [];
  const forbid = (name: string) => async () => {
    writes.push(name);
    throw new Error(`importer must not ${name}`);
  };
  return {
    writes,
    findEvent: async () => null,
    insertEvent: forbid('insertEvent'),
    acceptedEventIds: async () => new Set(),
    findMapping: async () => mapping,
    upsertMapping: forbid('upsertMapping'),
    upsertRecord: forbid('upsertRecord'),
    appendChange: forbid('appendChange'),
  };
}

export function mapping(partial: Partial<SyncEntityMappingRow> = {}): SyncEntityMappingRow {
  return {
    serverId: '42',
    serverVersion: 2,
    payloadHash: 'fnv1a:00000000',
    destinationKey: boundKey,
    ...partial,
  };
}

/** The unit-of-work transaction double; `savepoints` counts nested `transaction()` calls. */
export function dbOf(results: Array<unknown[] | Error> = []) {
  const db = fakeDb(results);
  let savepoints = 0;
  const transaction = db.transaction;
  db.transaction = (fn) => {
    savepoints += 1;
    return transaction(fn);
  };
  return Object.assign(db as unknown as Tx & { calls: ReturnType<typeof fakeDb>['calls'] }, {
    savepoints: () => savepoints,
  });
}

