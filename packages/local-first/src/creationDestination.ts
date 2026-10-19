/**
 * G10: the destination every local create path stamps, and the refusal a
 * later sync owes an unbound record.
 *
 * The gap this closes is not "there is no helper". `bindDestination.ts`,
 * `destinationBinding.ts`, `creationGate.ts`, and `creationBinding.ts` each
 * describe a *policy* for creation. What was missing is the thing every one
 * of those policies sits on top of: one registry of the create paths, one
 * function that turns a caller's destination into the value that gets STORED,
 * and one refusal a sync consults before it moves a pending event.
 *
 * Two states only, and both are representable:
 *
 *   - the record carries the caller's bound destination, or
 *   - the record carries `UNBOUND_DESTINATION`, the explicit "created offline,
 *     destination not chosen yet" state.
 *
 * A record is NEVER written with `destination` absent, `undefined`, or a
 * half-built object. `isUnboundDestination` is what recognises the second
 * state, and every reader of a record's destination must tolerate it, because
 * an offline device creates real work all day and there is nothing else it
 * can do with it.
 *
 * An unbound record is NOT syncable. `partitionUnboundPending` is the single
 * definition of that: it splits pending events into the ones a sync may carry
 * and the ones it must refuse. Refusal is total — the event is left in the
 * journal, unsent, unacknowledged. It is never dropped, and a batch is never
 * assembled so that only some of an unbound set goes.
 *
 * `chooseDestination` is the one later step that turns a refusal into a
 * success: it is an explicit call, it copies the caller's destination onto
 * the record AND onto its outstanding journal events, and it rewrites nothing
 * else. It never looks up a session, a token, a selected tenant, or a parent
 * record — the caller states the destination.
 *
 * This module imports nothing but `records.ts` and the store types. It opens
 * no file, reads no environment, and makes no network call. Keeping it free of
 * the policy modules is deliberate: those decide WHETHER a creation is
 * allowed, this one decides what is STORED and what a sync must refuse.
 */

import {
  UNBOUND_DESTINATION,
  destinationKey,
  type EntityDestination,
  type JournalEvent,
  type LocalEntityType,
  type LocalRecord,
} from './records.js';
import type { LocalFirstStore, LocalFirstTransaction } from './store.js';

/**
 * Same string `sync.ts` and the server's `destinationBindingError` use for a
 * client that pushed without naming a bound destination. One code, three
 * places: a refusal read locally is the same refusal the server would return,
 * so an unbound record fails on the device instead of after a round trip.
 */
export const SYNC_DESTINATION_REQUIRED = 'sync_destination_required';

/** Missing, unbound, or identity-less destination where a bound one is required. */
export const UNBOUND_DESTINATION_CODE = 'unbound_destination';

/** Entity types the Done-when names: project, ticket, chat, audit, and run. */
export const GATED_CREATE_ENTITY_TYPES = [
  'project',
  'ticket',
  'chat',
  'audit-run',
  'execution',
] as const satisfies readonly LocalEntityType[];

export type GatedCreateEntityType = (typeof GATED_CREATE_ENTITY_TYPES)[number];

/**
 * Every local create path in this package, and the entity types it writes.
 *
 * This is a registry, not a gate: it exists so a test can assert the invariant
 * over ALL of them rather than over whichever one a reviewer remembered. A
 * path is "gated" when it can write one of {@link GATED_CREATE_ENTITY_TYPES};
 * ungated paths (an audit finding, a memory fact) still store an explicit
 * destination, they simply have no G10 refusal ahead of them.
 */
export interface CreatePath {
  /** Stable id, used as the assertion label. */
  readonly id: string;
  /** Module that owns the write, relative to this package's `src/`. */
  readonly module: string;
  /** Exported entry a caller reaches the path through. */
  readonly entry: string;
  /** Entity types this path writes into the store. */
  readonly writes: readonly LocalEntityType[];
}

/** Frozen so a test cannot quietly grow the registry's coverage by mutation. */
export const LOCAL_CREATE_PATHS: readonly CreatePath[] = Object.freeze([
  Object.freeze({
    id: 'localWork.createProject',
    module: 'localWork.ts',
    entry: 'createLocalWork(store).createProject',
    writes: Object.freeze(['project'] as const),
  }),
  Object.freeze({
    id: 'localWork.createTicket',
    module: 'localWork.ts',
    entry: 'createLocalWork(store).createTicket',
    writes: Object.freeze(['ticket'] as const),
  }),
  Object.freeze({
    id: 'transactionalRecord.commit',
    module: 'transactionalRecord.ts',
    entry: 'createTransactionalRecordStore(options).commit',
    writes: Object.freeze(['project', 'ticket', 'chat', 'audit-run', 'execution'] as const),
  }),
  Object.freeze({
    id: 'hostChatRecord.ensureChat',
    module: 'hostChatRecord.ts',
    entry: 'createHostChatLog(store).appendTurn/appendRun/appendStep/appendApproval',
    writes: Object.freeze(['chat'] as const),
  }),
  Object.freeze({
    id: 'hostChatRecord.appendRun',
    module: 'hostChatRecord.ts',
    entry: 'createHostChatLog(store).appendRun',
    writes: Object.freeze(['execution'] as const),
  }),
  Object.freeze({
    id: 'localAudit.createLocalAuditFinding',
    module: 'localAudit.ts',
    entry: 'createLocalAuditFinding(store, input)',
    writes: Object.freeze(['audit-finding'] as const),
  }),
  Object.freeze({
    id: 'factProvenance.remember',
    module: 'factProvenance.ts',
    entry: 'createFactStore(store).remember',
    writes: Object.freeze(['memory-fact'] as const),
  }),
]);

const BINDING_FIELDS = [
  'platformInstance',
  'accountId',
  'tenantId',
  'projectId',
  'repository',
] as const;

/** Own data property only. A getter is a live lookup and is never invoked. */
function ownData(source: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, field);
  if (!descriptor || typeof descriptor.get === 'function') return undefined;
  return descriptor.value;
}

function knownString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Is this value the explicit unbound state?
 *
 * Only `{ kind: 'unbound' }` qualifies, including identity fields smuggled
 * onto it — an unbound record that also names a tenant is still unbound, and
 * those fields are not read. An absent `kind` on an object with no identity is
 * also unbound: it is a destination-shaped value that never chose anything.
 */
export function isUnboundDestination(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const kind = ownData(value, 'kind');
  if (kind === 'unbound') return true;
  if (kind !== undefined && kind !== 'bound') return true;
  for (const field of BINDING_FIELDS) {
    if (knownString(ownData(value, field))) return false;
  }
  return true;
}

/**
 * The destination a create path STORES for `proposed`.
 *
 * A bound destination is copied field by field into a frozen snapshot, so the
 * record does not retain a caller object that could be edited later and the
 * partition key cannot drift under a pending sync. Anything else — omitted,
 * null, unbound, a non-destination, an empty or whitespace identity field —
 * returns `UNBOUND_DESTINATION`.
 *
 * The return is ALWAYS an `EntityDestination`. This function never returns
 * undefined and never returns a partial object, which is what makes "the
 * field is explicitly present" true of every record written through it.
 */
export function resolveCreateDestination(
  proposed?: EntityDestination | null,
): EntityDestination {
  if (!proposed || typeof proposed !== 'object') return UNBOUND_DESTINATION;
  if (ownData(proposed, 'kind') === 'unbound') return UNBOUND_DESTINATION;
  const snapshot: { kind: 'bound' } & Record<string, string> = { kind: 'bound' };
  let identity = 0;
  for (const field of BINDING_FIELDS) {
    const value = knownString(ownData(proposed, field));
    if (!value) continue;
    snapshot[field] = value;
    identity += 1;
  }
  // `kind: 'bound'` with no field at all is not a destination; it is an empty
  // key pretending to be bound, and storing it would partition the record
  // under an identity nobody can resolve.
  if (identity === 0) return UNBOUND_DESTINATION;
  return Object.freeze(snapshot);
}

/**
 * The strict variant, for a caller whose policy already forbids an unbound
 * creation. It resolves the destination and refuses when the result is
 * unbound, throwing before any record is built.
 *
 * This is deliberately NOT what the create paths call: an offline device must
 * still be able to create real work. `creationBinding.ts` and
 * `destinationBinding.ts` are the modules that decide refusal; this one only
 * supplies it to a caller that asked for it.
 */
export function requireBoundCreateDestination(
  proposed?: EntityDestination | null,
): EntityDestination {
  const destination = resolveCreateDestination(proposed);
  if (destination.kind !== 'bound') {
    throw Object.assign(new Error(UNBOUND_DESTINATION_CODE), {
      code: UNBOUND_DESTINATION_CODE,
    });
  }
  return destination;
}

/** Why a record or event cannot be synced yet. */
export interface UnboundSyncRefusal {
  readonly code: typeof SYNC_DESTINATION_REQUIRED;
  readonly entityType: LocalEntityType;
  readonly clientEntityId: string;
  readonly eventId?: string;
  /** Partition key the work is parked in. `unbound` for an unbound record. */
  readonly partition: string;
}

/** True when a stored record carries `destination` as its own explicit field. */
export function hasExplicitDestination(record: unknown): record is { destination: EntityDestination } {
  if (!record || typeof record !== 'object') return false;
  return Object.hasOwn(record, 'destination');
}

/**
 * The refusal owed `record`, or null when it may sync.
 *
 * A record with no own `destination` field is refused for the same reason an
 * unbound one is: its partition is unknown, so a push would have nowhere to
 * land. The two are the same failure and get the same code.
 */
export function unboundRecordRefusal(record: Partial<LocalRecord> | null | undefined): UnboundSyncRefusal | null {
  if (!record || typeof record !== 'object') {
    return {
      code: SYNC_DESTINATION_REQUIRED,
      entityType: 'ticket',
      clientEntityId: 'unknown',
      partition: 'unbound',
    };
  }
  if (!isUnboundDestination(record.destination)) return null;
  return {
    code: SYNC_DESTINATION_REQUIRED,
    entityType: record.entityType ?? 'ticket',
    clientEntityId: record.id ?? 'unknown',
    partition: destinationKey(UNBOUND_DESTINATION),
  };
}

/**
 * Split pending events into the ones a sync may carry and the ones it must
 * refuse.
 *
 * A sync may not assemble a batch containing an unbound event, and it may not
 * silently drop one either. `refused` is the caller's signal that work is
 * parked, not lost: every refused event stays in the journal, unsent and
 * unacknowledged, until `chooseDestination` moves it.
 *
 * Both sides keep their input order, so the caller can still send `syncable`
 * in local sequence order.
 */
export function partitionUnboundPending(
  events: readonly JournalEvent[],
): { syncable: JournalEvent[]; refused: UnboundSyncRefusal[] } {
  const syncable: JournalEvent[] = [];
  const refused: UnboundSyncRefusal[] = [];
  for (const event of events) {
    if (isUnboundDestination(event.destination)) {
      refused.push({
        code: SYNC_DESTINATION_REQUIRED,
        entityType: event.entityType,
        clientEntityId: event.clientEntityId,
        eventId: event.eventId,
        partition: destinationKey(UNBOUND_DESTINATION),
      });
      continue;
    }
    syncable.push(event);
  }
  return { syncable, refused };
}

/** The refusal a caller gets from a single event, or null when it may sync. */
export function unboundEventRefusal(event: JournalEvent): UnboundSyncRefusal | null {
  if (!isUnboundDestination(event.destination)) return null;
  return {
    code: SYNC_DESTINATION_REQUIRED,
    entityType: event.entityType,
    clientEntityId: event.clientEntityId,
    eventId: event.eventId,
    partition: destinationKey(UNBOUND_DESTINATION),
  };
}

export interface ChooseDestinationInput<T> {
  /** The record being moved out of the unbound partition. */
  readonly record: LocalRecord<T>;
  /**
   * The destination the caller is choosing, stated explicitly. Nothing here
   * infers it: no session lookup, no token, no selected tenant, no parent.
   */
  readonly destination: EntityDestination;
  /** Device stamped on the rewritten provenance. */
  readonly deviceId: string;
  /** One ISO timestamp for the record and every event it moves. */
  readonly occurredAt?: string;
}

export interface ChooseDestinationResult<T> {
  readonly record: LocalRecord<T>;
  /** Events moved into the chosen partition, in their original order. */
  readonly moved: readonly JournalEvent[];
  /** Events already bound; left exactly as they were. */
  readonly untouched: readonly JournalEvent[];
}

/**
 * The one later step that makes an unbound record syncable.
 *
 * Moving the RECORD is not enough on its own, and that is the bug this
 * function exists to prevent: a record's destination and the destination on
 * its outstanding journal events are read independently by the sync path, so
 * rebinding the record alone leaves the create event parked in the unbound
 * partition forever. A record could look bound in the UI and still never sync.
 * So both halves move, in ONE transaction: either the record and its events
 * are rebound together, or neither is.
 *
 * Events keep their `eventId`, `localSequence`-based ordering, payload, and
 * `dependsOn` edges — only `destination` changes. Keeping the ids is what
 * preserves the dependency graph that other events point at, and keeping the
 * payloads is what makes this a rebind rather than a rewrite.
 *
 * An unbound record that is not in the store, or whose events are already
 * bound, is not an error: the caller gets back an empty `moved` and a record
 * that is simply already where it was asked to go.
 */
export async function chooseDestination<T>(
  store: LocalFirstStore,
  input: ChooseDestinationInput<T>,
): Promise<ChooseDestinationResult<T>> {
  const destination = requireBoundCreateDestination(input.destination);
  const deviceId = requireText(input.deviceId, 'device_id_required');
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  return store.transact(async (tx: LocalFirstTransaction) => {
    // Re-read inside the transaction. A caller that passed a stale copy must
    // not clobber a concurrent write.
    const current = await tx.get<T>(input.record.entityType, input.record.id);
    if (!current) {
      return { record: input.record, moved: [], untouched: [] };
    }
    const moved: JournalEvent[] = [];
    // An event already bound for THIS record needs no work: it was left there
    // deliberately. Anything else already bound belongs to another record in
    // the chosen partition and must not be touched.
    const untouched = (await tx.pending(destination))
      .filter((event) => event.clientEntityId === current.id);

    const rebound: LocalRecord<T> = {
      ...current,
      destination,
      updatedAt: occurredAt,
      provenance: { ...current.provenance, deviceId, source: current.provenance?.source ?? 'local' },
    };
    await tx.put(rebound);

    // Re-append in ascending local sequence so the journal's ordering — which
    // `batchEvents` walks to honour `dependsOn` — survives the move. The old
    // event is acknowledged first and carries the SAME id back in, so nothing
    // that depends on it is left pointing at a missing event.
    const unboundEvents = (await tx.pending(UNBOUND_DESTINATION))
      .filter((event) => isUnboundDestination(event.destination))
      .sort((a, b) => a.localSequence - b.localSequence);
    await tx.acknowledge(unboundEvents.map((event) => event.eventId));
    for (const event of unboundEvents) {
      const next = await tx.append({
        eventId: event.eventId,
        clientEntityId: event.clientEntityId,
        entityType: event.entityType,
        operation: event.operation,
        schemaVersion: event.schemaVersion,
        occurredAt: event.occurredAt,
        ...(event.baseVersion !== undefined ? { baseVersion: event.baseVersion } : {}),
        dependsOn: [...event.dependsOn],
        destination,
        payload: event.payload,
        payloadHash: event.payloadHash,
        ...(event.deadLetter ? { deadLetter: event.deadLetter } : {}),
      });
      moved.push(next);
    }
    return { record: rebound, moved, untouched };
  });
}

function requireText(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}