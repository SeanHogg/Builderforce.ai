/**
 * The journal's dependency graph, resolved at SEND time, per ENTITY.
 *
 * `dependsOn` is stored as the author wrote it: an idempotency KEY (`project:p:import`, `chat:c:v1`)
 * or, for an older stored event, a wire event id. A key names a logical write of an ENTITY, and the
 * key CHANGES over that entity's life (`project:p:v1` → `project:p:import`; an unbound chat marker →
 * `chat:c:import`), while a replaced write gets a new event id. So a dependency resolves, for the
 * dependent's own destination, to:
 *   - SATISFIED when the server already holds the dependency entity (a mapping exists there);
 *   - otherwise the newest of the entity's CREATING writes (`import` / `create`, never an update or
 *     delete: a ticket's import must not wait on a later chat edit) plus any event carrying exactly
 *     that key: live → wait on it; dead-lettered → BLOCKED (a later live creating write for the
 *     entity, under any key, unblocks); nothing pending in the dependent's destination → AWAITING
 *     BIND when the entity's record still sits live in the UNBOUND partition and is a type the sync
 *     pass binds (`SYNC_PASS_BIND_TYPES`): the next `bindWorkForSync` / `bindChatHistoryForSync`
 *     queues its import here, so the dependent must not go up first (a chat-ticket link made in a
 *     bound chat for a ticket whose project is still unbound). Otherwise → satisfied.
 * The entity comes from the referenced event, or from the key's `type:id:…` shape when `type` is a
 * known entity type; every other key (`execution:start:<run>`) is matched by exact key only.
 *
 * AWAITING BIND cannot strand a dependent: it needs a live, non-deleted, device-written record of a
 * type the sync pass ALWAYS moves out of the unbound partition, and the dependent's destination is
 * bound, so sync is running and the very next pass binds it (an unbound record of any other type —
 * one no pass binds — resolves satisfied, exactly as before).
 *
 * Pure. No store, no network (`loadMappedEntities` reads the store facts it needs up front).
 */

import { destinationKey, type JournalEvent, type LocalEntityType } from './records.js';
import type { LocalFirstTransaction } from './storeContract.js';

/**
 * The entity types a sync pass moves out of the unbound partition: the chat history
 * (`bindChatHistoryForSync`: chat, message, usage) and the work beside it (`bindWorkForSync`:
 * project, ticket, chat-ticket-link). The ONE list the dependency graph and the hosts' sync
 * triggers read.
 */
export const SYNC_PASS_BIND_TYPES: ReadonlySet<LocalEntityType> = new Set<LocalEntityType>([
  'chat', 'message', 'usage', 'project', 'ticket', 'chat-ticket-link',
]);

const KNOWN_TYPES: ReadonlySet<string> = new Set<LocalEntityType>([
  'project', 'ticket', 'chat', 'message', 'execution', 'step', 'approval', 'audit-definition', 'audit-run',
  'audit-finding', 'change-set', 'memory-fact', 'attachment-manifest', 'policy-snapshot', 'remediation',
  'usage', 'run-outcome', 'chat-ticket-link',
]);

const bySequence = (a: JournalEvent, b: JournalEvent): number => a.localSequence - b.localSequence;
const entityKey = (type: string, id: string): string => `${type}\u0000${id}`;
/** Key of "this destination holds this entity" in the `mapped` set. */
const mappedKey = (destination: JournalEvent['destination'], type: string, id: string): string =>
  `${destinationKey(destination)}\u0001${type}\u0000${id}`;

export interface DependencyIndex {
  readonly byId: ReadonlyMap<string, JournalEvent>;
  readonly byKey: ReadonlyMap<string, readonly JournalEvent[]>;
  readonly byEntity: ReadonlyMap<string, readonly JournalEvent[]>;
  /** Entities the server already holds, per destination (`mappedKey`). */
  readonly mapped: ReadonlySet<string>;
}

export type ResolvedDependency =
  | { kind: 'event'; event: JournalEvent }
  | { kind: 'blocked' }
  | { kind: 'satisfied' };

/** Index EVERY journal event (live and dead-lettered), each list in sequence order. */
export function dependencyIndex(all: readonly JournalEvent[], mapped: ReadonlySet<string> = new Set()): DependencyIndex {
  const byId = new Map<string, JournalEvent>();
  const byKey = new Map<string, JournalEvent[]>();
  const byEntity = new Map<string, JournalEvent[]>();
  for (const event of [...all].sort(bySequence)) {
    byId.set(event.eventId, event);
    if (event.idempotencyKey !== undefined) {
      const list = byKey.get(event.idempotencyKey) ?? [];
      list.push(event);
      byKey.set(event.idempotencyKey, list);
    }
    const key = entityKey(event.entityType, event.clientEntityId);
    const list = byEntity.get(key) ?? [];
    list.push(event);
    byEntity.set(key, list);
  }
  return { byId, byKey, byEntity, mapped };
}

/** The entity a dependency names, when it names one. */
function dependencyEntity(dependency: string, index: DependencyIndex): { type: string; id: string } | undefined {
  const referenced = index.byId.get(dependency);
  if (referenced) return { type: referenced.entityType, id: referenced.clientEntityId };
  const parts = dependency.split(':');
  const [type, id] = parts;
  if (parts.length >= 3 && type && id && KNOWN_TYPES.has(type)) return { type, id };
  return undefined;
}

const isCreating = (event: JournalEvent): boolean => event.operation === 'import' || event.operation === 'create';

/** What a dependency of `dependent` means RIGHT NOW (see the module comment). */
export function resolveDependency(dependency: string, index: DependencyIndex, dependent: JournalEvent): ResolvedDependency {
  const entity = dependencyEntity(dependency, index);
  if (entity && index.mapped.has(mappedKey(dependent.destination, entity.type, entity.id))) return { kind: 'satisfied' };
  const home = destinationKey(dependent.destination);
  const pool = new Set<JournalEvent>(index.byKey.get(dependency) ?? []);
  const referenced = index.byId.get(dependency);
  if (referenced) {
    pool.add(referenced);
    // A dependency named by WIRE ID follows its logical write: a requeued dead letter
    // (`requeueJournalDeadLetter`) is the same write appended again under the same key with a new id,
    // so an UPDATE/DELETE dependency (not a creating write, which the entity pass below finds) is
    // satisfied by its live successor instead of staying blocked behind the dead letter.
    if (referenced.idempotencyKey !== undefined) {
      for (const successor of index.byKey.get(referenced.idempotencyKey) ?? []) pool.add(successor);
    }
  }
  if (entity) {
    for (const event of index.byEntity.get(entityKey(entity.type, entity.id)) ?? []) {
      if (isCreating(event)) pool.add(event);
    }
  }
  const newest = [...pool].filter((event) => destinationKey(event.destination) === home).sort(bySequence).pop();
  if (!newest) return { kind: 'satisfied' };
  return newest.deadLetter ? { kind: 'blocked' } : { kind: 'event', event: newest };
}

/**
 * Which dependency entities the server already holds, per destination: one mapping read per
 * distinct (destination, entity) a pending event depends on. Feed the result to `dependencyIndex`.
 */
export async function loadMappedEntities(tx: LocalFirstTransaction, all: readonly JournalEvent[]): Promise<Set<string>> {
  const index = dependencyIndex(all);
  const mapped = new Set<string>();
  const seen = new Set<string>();
  for (const event of all) {
    for (const dependency of event.dependsOn) {
      const entity = dependencyEntity(dependency, index);
      if (!entity) continue;
      const key = mappedKey(event.destination, entity.type, entity.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const mapping = await tx.mapping(entity.type as LocalEntityType, entity.id, event.destination);
      if (mapping && mapping.serverVersion > 0) mapped.add(key);
    }
  }
  return mapped;
}

/**
 * Live events that cannot be sent because something they (transitively) depend on was
 * DEAD-LETTERED and no live creating write has replaced it. They are blocked, not dead-lettered.
 */
export function blockedEventIds(all: readonly JournalEvent[], mapped: ReadonlySet<string> = new Set()): Set<string> {
  const blocked = new Set<string>();
  if (!all.some((event) => event.deadLetter)) return blocked;
  const index = dependencyIndex(all, mapped);
  const live = all.filter((event) => !event.deadLetter).sort(bySequence);
  for (let changed = true; changed;) {
    changed = false;
    for (const event of live) {
      if (blocked.has(event.eventId)) continue;
      const stuck = event.dependsOn.some((dependency) => {
        const resolved = resolveDependency(dependency, index, event);
        return resolved.kind === 'blocked' || (resolved.kind === 'event' && resolved.event.eventId !== event.eventId && blocked.has(resolved.event.eventId));
      });
      if (stuck) {
        blocked.add(event.eventId);
        changed = true;
      }
    }
  }
  return blocked;
}
