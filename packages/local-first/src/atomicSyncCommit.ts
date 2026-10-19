/**
 * G14: a domain write and its sync enqueue commit together.
 *
 * The plan is pure. Its event id is `entityType:clientId:version`, so a retry
 * of the same version cannot mint a second identity. `applyAtomicSyncCommit`
 * writes that plan in one `transact`. The store publishes the draft only after
 * the callback resolves, so a throw from append is not a committed record
 * without its event. This layer has no other write path.
 */

import type { JournalEvent, JournalOperation, LocalEntityType, LocalRecord } from './records.js';
import type { LocalFirstStore } from './store.js';

export type PlannedSyncEvent<T = unknown> = Omit<JournalEvent<T>, 'localSequence' | 'payloadHash'> & {
  payloadHash?: string;
};

export interface AtomicSyncCommitPlan<T = unknown> {
  record: LocalRecord<T>;
  event: PlannedSyncEvent<T>;
}

export interface PlanAtomicSyncCommitInput<T = unknown> {
  record: LocalRecord<T>;
  operation?: JournalOperation;
  dependsOn?: readonly string[];
  occurredAt?: string;
}

export function stableSyncEventId(entityType: LocalEntityType, clientId: string, version: number): string {
  return `${entityType}:${clientId}:${version}`;
}

function snapshot<T>(value: T): T {
  return structuredClone(value);
}

function operationFor(record: LocalRecord): JournalOperation {
  if (typeof record.deletedAt === 'string' && record.deletedAt.trim() !== '') return 'delete';
  return record.version === 1 ? 'create' : 'update';
}

/** Pure: same record version always plans the same event id. Writes nothing. */
export function planAtomicSyncCommit<T>(input: PlanAtomicSyncCommitInput<T>): AtomicSyncCommitPlan<T> {
  const record = snapshot(input.record);
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new Error('client_entity_id_must_be_stable_uuid');
  }
  if (!Number.isSafeInteger(record.version) || record.version < 1) {
    throw new Error('atomic_sync_version_required');
  }
  const occurredAt = input.occurredAt ?? record.updatedAt ?? record.occurredAt;
  if (typeof occurredAt !== 'string' || occurredAt.trim() === '') {
    throw new Error('atomic_sync_occurred_at_required');
  }
  const event: PlannedSyncEvent<T> = {
    eventId: stableSyncEventId(record.entityType, record.id, record.version),
    clientEntityId: record.id,
    entityType: record.entityType,
    operation: input.operation ?? operationFor(record),
    schemaVersion: record.schemaVersion,
    occurredAt,
    ...(record.baseVersion !== undefined ? { baseVersion: record.baseVersion } : {}),
    dependsOn: [...(input.dependsOn ?? [])],
    destination: snapshot(record.destination),
    payload: record.payload,
  };
  return { record, event };
}

/**
 * Put the planned record and append its event in one transaction.
 * Refuses a store that cannot transact rather than writing them separately.
 */
export async function applyAtomicSyncCommit<T>(
  store: Pick<LocalFirstStore, 'transact'>,
  plan: AtomicSyncCommitPlan<T>,
): Promise<JournalEvent<T>> {
  if (typeof store?.transact !== 'function') {
    throw new Error('atomic_sync_commit_requires_transact');
  }
  const expected = stableSyncEventId(plan.record.entityType, plan.record.id, plan.record.version);
  if (plan.event.eventId !== expected || plan.event.clientEntityId !== plan.record.id || plan.event.entityType !== plan.record.entityType) {
    throw new Error('atomic_sync_event_id_unstable');
  }
  return store.transact(async (tx) => {
    await tx.put(plan.record);
    return tx.append(plan.event);
  });
}
