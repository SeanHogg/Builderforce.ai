/**
 * Application — accept one sync push batch (G15/G16/G17/G25).
 *
 * Order of decisions, per batch then per event:
 *
 * 1. Envelope (`readPushBatch`): protocol version, ids, event list, in-batch
 *    dependency order. A failure is a 400 and nothing is applied.
 * 2. Destination (`resolveSyncDestination`): tenant from auth, project owned by
 *    the tenant, the first-bind policy. A failure is a 400/403.
 * 3. Per event, in dependency order:
 *    a. replay — an existing receipt for (tenant, device, eventId) answers
 *       `duplicate` (or its stored status) BEFORE any other check, and a
 *       replay with a different payload is `event_payload_mismatch`;
 *    b. `refuseBeforeInsert` — shape, ids, schema, occurredAt, hash,
 *       destination, importer owner;
 *    c. an unmapped destination project, or an unmet `dependsOn`, is
 *       `dependency_pending` and writes nothing (it stays retryable);
 *    d. ONE unit of work, a SAVEPOINT inside the chunk's transaction: the
 *       named importer's domain write, then mapping, projection, change row and
 *       receipt — all release or none do.
 *
 * The ordered events run in CHUNKS of PUSH_CHUNK_EVENTS (`syncChunking.ts`), one
 * transaction per chunk, opened lazily when an event first reaches step (d) (a
 * replay-only chunk opens none). A deadlock/serialization failure retries the
 * chunk. The importers' cache bumps are collected per chunk and run once after
 * THAT chunk commits, never when it does not. A throw out of a chunk rolls the
 * WHOLE chunk back (not just the failing event) and propagates: no receipts.
 *
 * Writes that sit OUTSIDE the transaction: the run-step store and the usage ledger
 * live on the operational database (`syncStepStore`, `syncUsageLedger`) and commit
 * on their own connection; on a retry or a rolled-back chunk they are deduped by
 * their event / idempotency keys, never applied twice.
 *
 * Only the receipt race is per-event: two deliveries of the same event racing
 * past (a) both reach (d); the second insert violates the receipt's unique index,
 * its savepoint rolls back (domain write included, the chunk goes on), and it is
 * answered from the winner's receipt.
 *
 * Receipts come back in INPUT order, one per event.
 */

import { hashSyncPayload, isJournalEventId, type SyncReceipt } from '../../domain/sync/syncProtocol';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import { serverNumericId, syncImporterFor } from './importers';
import {
  asSyncEvent,
  readPushBatch,
  receipt,
  refuseBeforeInsert,
  type ParsedEvent,
} from './syncEnvelope';
import { normalisedKeyOf, resolveSyncDestination, type BoundSyncDestination } from './syncDestination';
import { persistAccepted, persistConflict, replayReceipt, type ApplyScope } from './syncPersist';
import type { SyncAuthContext, SyncImportContext, SyncStores, SyncStoreSet } from './syncPorts';
import {
  CHUNK_CONFLICT_RETRIES,
  PUSH_CHUNK_EVENTS,
  conflictBackoff,
  isTransactionConflict,
  lazyChunk,
  type SyncChunkUnit,
} from './syncChunking';

export interface SyncPushDeps {
  auth: SyncAuthContext;
  now: Date;
  stores: SyncStores;
}

export type SyncPushResponse =
  | { ok: false; status: 400 | 403; code: string }
  | { ok: true; status: 200; receipts: SyncReceipt[] };

/**
 * A project/ticket reference → a server id OWNED by this tenant: a client UUID
 * this tenant already mapped (read inside the unit of work, so a project
 * imported earlier in the batch resolves), or a decimal id the tenant owns.
 */
async function resolveReference(
  tx: SyncStoreSet,
  stores: SyncStores,
  tenantId: number,
  entityType: 'project' | 'ticket',
  reference: string,
): Promise<number | null> {
  const ref = reference.trim();
  if (ref === '') return null;
  const id = serverNumericId(ref);
  if (id !== null) {
    const owned = entityType === 'project'
      ? await stores.references.projectInTenant(tenantId, id)
      : await stores.references.taskInTenant(tenantId, id);
    return owned ? id : null;
  }
  // Only a client UUID can be a mapped reference (the column is a uuid).
  if (!isJournalEventId(ref)) return null;
  const mapping = await tx.findMapping(tenantId, entityType, ref);
  return mapping ? serverNumericId(mapping.serverId) : null;
}

/**
 * Chat ownership answered once per push: a batch of one chat's messages and usage asks
 * the same question for every event. Keyed by the push's deps, so it never outlives it.
 */
const ownedChatsByPush = new WeakMap<SyncPushDeps, Map<number, Promise<boolean>>>();

function ownsChat(deps: SyncPushDeps, batch: SyncChunkUnit, chatId: number): Promise<boolean> {
  let owned = ownedChatsByPush.get(deps);
  if (!owned) ownedChatsByPush.set(deps, (owned = new Map()));
  let answer = owned.get(chatId);
  if (!answer) {
    // Read on the BATCH transaction: a chat an earlier event of this batch created is not
    // committed yet, so a read on another connection would not see it.
    answer = batch.references.chatOwnedBy(deps.auth.tenantId, deps.auth.userId, chatId);
    owned.set(chatId, answer);
  }
  return answer;
}

function importContext(
  tx: SyncStoreSet,
  deps: SyncPushDeps,
  batch: SyncChunkUnit,
  scope: ApplyScope,
  bound: BoundSyncDestination,
  afterCommit: (effect: () => Promise<unknown>) => void,
): SyncImportContext {
  const tenantId = deps.auth.tenantId;
  return {
    auth: deps.auth,
    deviceId: scope.deviceId,
    destination: bound.destination,
    destinationKey: bound.key,
    now: deps.now,
    resolveProjectId: (reference) => resolveReference(tx, deps.stores, tenantId, 'project', reference),
    resolveTaskId: (reference) => resolveReference(tx, deps.stores, tenantId, 'ticket', reference),
    isTenantMember: (userId) => deps.stores.references.tenantMember(tenantId, userId),
    resolveOwnChatId: async (chatId) => ((await ownsChat(deps, batch, chatId)) ? chatId : null),
    afterCommit,
  };
}

/**
 * The first `dependsOn` id with no accepted receipt, or null when every edge is met.
 *
 * `sync_events` is swept at 90 days (`SYNC_EVENT_RETENTION_DAYS`), so a dependency whose
 * receipt was swept reads as unmet here. That is not decided on this side: the CLIENT drops
 * an edge once the server holds the dependency (`packages/local-first/src/dependencyGraph.ts`,
 * `resolveDependency`), and dead-letters an event that stays pending past the server's
 * event retention as `dependency_unresolvable` (`holdLimits.ts`). A genuinely missing
 * dependency stays `dependency_pending`.
 */
async function unmetDependency(
  stores: SyncStores,
  tenantId: number,
  dependsOn: readonly string[],
  acceptedThisBatch: ReadonlySet<string>,
): Promise<string | null> {
  const external = dependsOn.filter((id) => !acceptedThisBatch.has(id));
  if (external.length === 0) return null;
  const accepted = await stores.acceptedEventIds(tenantId, external);
  return external.find((id) => !accepted.has(id)) ?? null;
}

/** Cache bumps the importers queued; they run ONCE, after the batch transaction commits. */
type BatchEffects = Array<() => Promise<unknown>>;

/** Step (d): one atomic unit of work (a SAVEPOINT of the batch transaction) for one event. */
async function applyEvent(
  event: ParsedEvent,
  deps: SyncPushDeps,
  scope: ApplyScope,
  bound: BoundSyncDestination,
  batch: SyncChunkUnit,
  batchEffects: BatchEffects,
): Promise<SyncReceipt> {
  const receivedAt = deps.now.toISOString();
  // Per event, merged into the batch only if this event's savepoint is released: a rolled-back
  // event's cache bumps are not true.
  const effects: BatchEffects = [];
  const decided = await batch.savepoint(async ({ stores: tx, importers }) => {
    const name = syncImporterFor(event.entityType);
    const importer = name ? importers[name] : undefined;
    if (!importer) return receipt(event.eventId, 'rejected', receivedAt, { detail: 'entity_type_rejected' });

    const outcome = await importer(asSyncEvent(event, bound.destination), importContext(tx, deps, batch, scope, bound, (effect) => { effects.push(effect); }), tx);
    if (outcome.status === 'applied') {
      await persistAccepted(tx, event, scope, outcome);
      return receipt(event.eventId, 'accepted', receivedAt, outcome);
    }
    if (outcome.status === 'conflict') {
      await persistConflict(tx, event, scope, outcome);
      return receipt(event.eventId, 'conflict', receivedAt, outcome);
    }
    // A parent the importer could not resolve yet: held, nothing written (step c's twin).
    if (outcome.status === 'pending') return receipt(event.eventId, 'dependency_pending', receivedAt, { detail: outcome.detail });
    return receipt(event.eventId, 'rejected', receivedAt, { detail: outcome.detail });
  });
  batchEffects.push(...effects);
  return decided;
}

async function decideEvent(
  event: ParsedEvent,
  deps: SyncPushDeps,
  scope: ApplyScope,
  bound: BoundSyncDestination,
  acceptedThisBatch: ReadonlySet<string>,
  batch: SyncChunkUnit,
  batchEffects: BatchEffects,
): Promise<SyncReceipt> {
  const tenantId = deps.auth.tenantId;
  const receivedAt = deps.now.toISOString();
  const replayHash = hashSyncPayload(event.payload);

  // (a) Replay first: the receipt journal answers, whatever else changed since.
  if (isJournalEventId(event.eventId)) {
    const existing = await deps.stores.findEvent(tenantId, scope.deviceId, event.eventId);
    if (existing) return replayReceipt(event.eventId, replayHash, existing);
  }

  // (b) Refusals that need no store.
  const refused = refuseBeforeInsert(event, bound.key, (d) => normalisedKeyOf(d, deps.auth), deps.now);
  if (refused) return refused;

  // (c) Retryable holds — nothing is written.
  if (bound.projectPending) {
    return receipt(event.eventId, 'dependency_pending', receivedAt, { detail: 'destination_project_pending' });
  }
  const unmet = await unmetDependency(deps.stores, tenantId, event.dependsOn, acceptedThisBatch);
  if (unmet) return receipt(event.eventId, 'dependency_pending', receivedAt, { detail: unmet });

  // (d) Apply. A lost race on the receipt's unique index is answered from the winner.
  try {
    return await applyEvent(event, deps, scope, bound, batch, batchEffects);
  } catch (error) {
    if (!isUniqueViolation(error, 'uq_sync_events_event')) throw error;
    const winner = await deps.stores.findEvent(tenantId, scope.deviceId, event.eventId);
    if (!winner) throw error;
    return replayReceipt(event.eventId, replayHash, winner);
  }
}

/**
 * Decide and apply one chunk of events in ONE (lazily opened) transaction. A deadlock or
 * serialization failure retries the whole chunk with fresh per-attempt state; nothing of a failed
 * attempt (receipts, accepted ids, cache bumps, chat-ownership answers) survives it.
 */
async function commitChunk(
  chunk: readonly ParsedEvent[],
  deps: SyncPushDeps,
  scope: ApplyScope,
  bound: BoundSyncDestination,
  acceptedBefore: ReadonlySet<string>,
): Promise<{ receipts: Map<string, SyncReceipt>; effects: BatchEffects }> {
  for (let attempt = 1; ; attempt += 1) {
    ownedChatsByPush.delete(deps);
    const unit = lazyChunk(deps.stores);
    const accepted = new Set(acceptedBefore);
    const receipts = new Map<string, SyncReceipt>();
    const effects: BatchEffects = [];
    try {
      for (const event of chunk) {
        const decided = await decideEvent(event, deps, scope, bound, accepted, unit, effects);
        if (decided.status === 'accepted' || decided.status === 'duplicate') accepted.add(event.eventId);
        receipts.set(event.eventId, decided);
      }
      await unit.settle();
      return { receipts, effects };
    } catch (error) {
      await unit.settle(error).catch(() => undefined);
      if (attempt > CHUNK_CONFLICT_RETRIES || !isTransactionConflict(error)) throw error;
      await conflictBackoff(attempt);
    }
  }
}

/** Accept one push batch. See the module comment for the decision order. */
export async function handleSyncPush(body: unknown, deps: SyncPushDeps): Promise<SyncPushResponse> {
  const read = readPushBatch(body);
  if (!read.ok) return { ok: false, status: 400, code: read.code };
  const { batch } = read;

  const projectsCreatedInBatch = new Set(
    batch.events
      .filter((event) => event.entityType === 'project' && (event.operation === 'create' || event.operation === 'import'))
      .map((event) => event.clientEntityId.toLowerCase()),
  );
  const bound = await resolveSyncDestination(batch.destination, deps.auth, deps.stores, {
    purpose: 'push',
    projectsCreatedInBatch,
  });
  if (!bound.ok) return { ok: false, status: bound.status, code: bound.code };

  const scope: ApplyScope = {
    auth: deps.auth,
    deviceId: batch.deviceId,
    batchId: batch.batchId,
    destination: bound.destination,
    now: deps.now,
  };
  const acceptedThisBatch = new Set<string>();
  const byId = new Map<string, SyncReceipt>();
  // The ordered events run in chunks, one transaction each. A throw out of a chunk (anything but
  // the receipt-race an event answers itself, or a deadlock that survives its retries) rolls THAT
  // chunk back and propagates as it always has: no receipts are returned. Earlier chunks stay
  // committed; their receipts are journalled, so the client's retry replays them as duplicates.
  for (let start = 0; start < batch.ordered.length; start += PUSH_CHUNK_EVENTS) {
    const chunk = batch.ordered.slice(start, start + PUSH_CHUNK_EVENTS);
    const done = await commitChunk(chunk, deps, scope, bound, acceptedThisBatch);
    for (const [eventId, decided] of done.receipts) {
      byId.set(eventId, decided);
      if (decided.status === 'accepted' || decided.status === 'duplicate') acceptedThisBatch.add(eventId);
    }
    // The chunk has committed: only now are the importers' cache bumps true. A bump that fails
    // must not turn a committed import into a retry.
    await Promise.allSettled(done.effects.map((effect) => effect()));
  }

  return {
    ok: true,
    status: 200,
    receipts: batch.events.map((event) => byId.get(event.eventId) as SyncReceipt),
  };
}
