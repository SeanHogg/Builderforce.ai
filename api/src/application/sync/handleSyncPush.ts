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
 *    d. ONE unit of work: the named importer's domain write, then mapping,
 *       projection, change row and receipt — all commit or none do.
 *
 * Two deliveries of the same event racing past (a) both reach (d); the second
 * insert violates the receipt's unique index, its unit of work rolls back
 * (domain write included), and it is answered from the winner's receipt.
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

function ownsChat(deps: SyncPushDeps, chatId: number): Promise<boolean> {
  let owned = ownedChatsByPush.get(deps);
  if (!owned) ownedChatsByPush.set(deps, (owned = new Map()));
  let answer = owned.get(chatId);
  if (!answer) {
    answer = deps.stores.references.chatOwnedBy(deps.auth.tenantId, deps.auth.userId, chatId);
    owned.set(chatId, answer);
  }
  return answer;
}

function importContext(
  tx: SyncStoreSet,
  deps: SyncPushDeps,
  scope: ApplyScope,
  bound: BoundSyncDestination,
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
    resolveOwnChatId: async (chatId) => ((await ownsChat(deps, chatId)) ? chatId : null),
  };
}

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

/** Step (d): one atomic unit of work for one event. */
function applyEvent(
  event: ParsedEvent,
  deps: SyncPushDeps,
  scope: ApplyScope,
  bound: BoundSyncDestination,
): Promise<SyncReceipt> {
  const receivedAt = deps.now.toISOString();
  return deps.stores.transact(async ({ stores: tx, importers }) => {
    const name = syncImporterFor(event.entityType);
    const importer = name ? importers[name] : undefined;
    if (!importer) return receipt(event.eventId, 'rejected', receivedAt, { detail: 'entity_type_rejected' });

    const outcome = await importer(asSyncEvent(event, bound.destination), importContext(tx, deps, scope, bound), tx);
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
}

async function decideEvent(
  event: ParsedEvent,
  deps: SyncPushDeps,
  scope: ApplyScope,
  bound: BoundSyncDestination,
  acceptedThisBatch: ReadonlySet<string>,
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
    return await applyEvent(event, deps, scope, bound);
  } catch (error) {
    if (!isUniqueViolation(error, 'uq_sync_events_event')) throw error;
    const winner = await deps.stores.findEvent(tenantId, scope.deviceId, event.eventId);
    if (!winner) throw error;
    return replayReceipt(event.eventId, replayHash, winner);
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
  for (const event of batch.ordered) {
    const decided = await decideEvent(event, deps, scope, bound, acceptedThisBatch);
    if (decided.status === 'accepted' || decided.status === 'duplicate') acceptedThisBatch.add(event.eventId);
    byId.set(event.eventId, decided);
  }

  return {
    ok: true,
    status: 200,
    receipts: batch.events.map((event) => byId.get(event.eventId) as SyncReceipt),
  };
}
