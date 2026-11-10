/**
 * A BOUND event whose payload is read from its record when it is sent (2026-11-10).
 *
 * A bound `import` is "the row as it is now" (`queueImport`): its payload is the record's. Keeping
 * a copy on the event doubled a long-offline history on disk until every import was sent — a
 * measured 88k imports ≈ 150 MB beside the rows they copy. The import is queued as a MARKER
 * instead (`payloadFrom: 'record'`, `payload: null`) and the coordinator MATERIALIZES it right
 * before the push that sends it: payload from the current record, `payloadHash` computed then.
 *
 * The server verifies only that the hash matches the payload sent (`syncEnvelope.ts`
 * `refuseBeforeInsert`) and that a REPLAY of an event id carries the hash of its first delivery
 * (`syncPersist.ts` `replayReceipt`). So the materialized payload is committed to the event BEFORE
 * the push (`LocalFirstTransaction.materializeEvent`), stamped `materializedAt`: a retry after a
 * lost response re-sends the same bytes, whatever the record did meanwhile, and nothing turns a
 * materialized event back into a marker (`eventBacklogMigration.ts`). Only events in flight carry
 * a payload.
 *
 * OLDER BUILDS sharing the journal know nothing of `payloadFrom`, and two of their paths could
 * send a marker's null payload: their batcher, and their rebase (`rebaseImportsOntoMapping` /
 * `rebaseNewerWrites` copy an event's payload and `dependsOn` into a NEW `update`, dropping every
 * other field). Every marker is therefore FENCED: its `dependsOn` names `RECORD_PAYLOAD_FENCE_KEY`,
 * and each bound partition holding markers carries one dead-lettered fence event under that key.
 * Every build's dependency graph resolves a dependency whose newest event is dead-lettered as
 * BLOCKED and never sends it, nor anything that (transitively) depends on it — and the rebase
 * copies `dependsOn`, so a rebased marker stays fenced. This build ignores the fence (it resolves
 * as satisfied, `dependencyGraph.ts`), and SELF-HEALS a rebased marker: a bound non-delete event
 * with a null payload hashed as null is read from its record like any marker.
 * (`nextAttemptAt` far in the future is kept as a second guard for the batcher.)
 */

import { hashPayload } from './payloadHash.js';
import type { EntityDestination, JournalEvent } from './records.js';
import { destinationKey } from './records.js';
import type { LocalFirstTransaction } from './storeContract.js';

/** The backoff a marker carries so a build that cannot materialize it never sends it. */
export const MARKER_NOT_BEFORE = '9999-12-31T23:59:59.999Z';

/** The dependency every marker carries: older builds resolve it as BLOCKED (module comment). */
export const RECORD_PAYLOAD_FENCE_KEY = 'builderforce:record-payload-fence:v1';
/** The fence event's row id: no record ever has it. */
export const RECORD_PAYLOAD_FENCE_ID = '00000000-0000-4000-8000-00000000fe0c';
/** The fence's dead-letter reason: not re-queueable, and hidden from the dead-letter list. */
export const RECORD_PAYLOAD_FENCE_REASON = 'record_payload_fence';

const NULL_PAYLOAD_HASH = hashPayload(null);

/** The fields that make an appended event a record-payload marker (its `dependsOn` takes `fencedDependsOn`). */
export function recordPayloadMarker(): { payload: null; payloadFrom: 'record'; nextAttemptAt: string } {
  return { payload: null, payloadFrom: 'record', nextAttemptAt: MARKER_NOT_BEFORE };
}

/** A marker's dependencies: the caller's, plus the fence. */
export function fencedDependsOn(dependsOn: readonly string[]): string[] {
  return dependsOn.includes(RECORD_PAYLOAD_FENCE_KEY) ? [...dependsOn] : [...dependsOn, RECORD_PAYLOAD_FENCE_KEY];
}

/** The partition's fence event (module comment). */
export function isRecordPayloadFence(event: Pick<JournalEvent, 'idempotencyKey'>): boolean {
  return event.idempotencyKey === RECORD_PAYLOAD_FENCE_KEY;
}

/**
 * Whether the event's payload is read from its record when sent: a marker, or a marker an older
 * build rebased into a bound `update` (null payload hashed as null — the only bound non-delete
 * write that carries no payload). A materialized event never is.
 */
export function isRecordPayloadMarker(
  event: Pick<JournalEvent, 'payloadFrom' | 'payload' | 'payloadHash' | 'operation' | 'destination' | 'materializedAt'>,
): boolean {
  if (event.payloadFrom === 'record') return true;
  return event.materializedAt === undefined
    && event.destination?.kind === 'bound'
    && event.operation !== 'delete'
    && event.payload === null
    && event.payloadHash === NULL_PAYLOAD_HASH;
}

/** `event` carrying `payload` (and its hash), stamped `materializedAt`, unfenced: no longer a marker. */
export function materializedEvent(event: JournalEvent, payload: unknown, at: string = new Date().toISOString()): JournalEvent {
  const { payloadFrom: _from, nextAttemptAt, payloadSize: _size, ...rest } = event as JournalEvent & { payloadSize?: number };
  return {
    ...rest,
    ...(nextAttemptAt !== undefined && nextAttemptAt !== MARKER_NOT_BEFORE ? { nextAttemptAt } : {}),
    dependsOn: event.dependsOn.filter((dependency) => dependency !== RECORD_PAYLOAD_FENCE_KEY),
    payload,
    payloadHash: hashPayload(payload),
    materializedAt: at,
  };
}

/** The fence event a partition's markers depend on (dead-lettered; never sent). */
export function recordPayloadFenceEvent(destination: EntityDestination, eventId: string, localSequence: number, at: string): JournalEvent {
  return {
    eventId,
    idempotencyKey: RECORD_PAYLOAD_FENCE_KEY,
    clientEntityId: RECORD_PAYLOAD_FENCE_ID,
    entityType: 'policy-snapshot',
    operation: 'create',
    schemaVersion: 1,
    localSequence,
    occurredAt: at,
    dependsOn: [],
    destination,
    payload: null,
    payloadHash: NULL_PAYLOAD_HASH,
    deadLetter: { reason: RECORD_PAYLOAD_FENCE_REASON, at },
  };
}

/** Make sure `destination` carries its fence event (once per partition). */
export async function ensureRecordPayloadFence(tx: LocalFirstTransaction, destination: EntityDestination): Promise<void> {
  const key = destinationKey(destination);
  const lookup = tx.pendingLookup?.();
  let present = false;
  if (lookup) {
    present = lookup.byKey(RECORD_PAYLOAD_FENCE_KEY).some((event) => destinationKey(event.destination) === key);
  } else {
    await tx.scanPending((event) => { if (isRecordPayloadFence(event)) present = true; }, destination);
  }
  if (present) return;
  const at = new Date().toISOString();
  const fence = await tx.append({
    idempotencyKey: RECORD_PAYLOAD_FENCE_KEY,
    clientEntityId: RECORD_PAYLOAD_FENCE_ID,
    entityType: 'policy-snapshot',
    operation: 'create',
    schemaVersion: 1,
    occurredAt: at,
    dependsOn: [],
    destination,
    payload: null,
  });
  await tx.deadLetter(fence.eventId, RECORD_PAYLOAD_FENCE_REASON, at);
}
