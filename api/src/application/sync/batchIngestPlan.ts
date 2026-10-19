/**
 * Application — dependency-aware domain batch plan (G15).
 *
 * One logical sync batch replaces many CRUD round trips. This orders the
 * batch from client references and in-batch `dependsOn` edges, and stamps a
 * per-item acknowledgement placeholder. It does not ingest, import, route,
 * or persist: a cycle, a duplicate client reference, or a dependency that is
 * not in the batch plans nothing.
 */

export interface BatchIngestItem {
  clientRef: string;
  entityType: string;
  operation: string;
  dependsOn: readonly string[];
}

/** Placeholder until the batch is applied. Not a server receipt. */
export interface PlannedBatchAcknowledgement {
  clientRef: string;
  status: 'planned';
}

export type BatchIngestPlan =
  | {
      ok: true;
      /** Apply order: every in-batch `dependsOn` client ref precedes the item that names it. */
      items: BatchIngestItem[];
      acknowledgements: PlannedBatchAcknowledgement[];
    }
  | { ok: false; reason: 'cycle' }
  | { ok: false; reason: 'missing_dependency'; clientRef: string; missing: string }
  | { ok: false; reason: 'duplicate_client_ref'; clientRef: string };

function insertByOriginalIndex(
  queue: string[],
  clientRef: string,
  indexOf: (ref: string) => number,
): void {
  const index = indexOf(clientRef);
  let at = queue.length;
  for (let position = 0; position < queue.length; position += 1) {
    const queued = queue[position];
    if (queued !== undefined && indexOf(queued) > index) {
      at = position;
      break;
    }
  }
  queue.splice(at, 0, clientRef);
}

/**
 * Plan one logical ingest batch. Dependencies are other `clientRef`s in the
 * same batch. Independent items keep their input order. The input array is
 * not mutated.
 */
export function planBatchIngest(items: readonly BatchIngestItem[]): BatchIngestPlan {
  const indexOfRef = new Map<string, number>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    if (indexOfRef.has(item.clientRef)) {
      return { ok: false, reason: 'duplicate_client_ref', clientRef: item.clientRef };
    }
    indexOfRef.set(item.clientRef, index);
  }

  const indexOf = (ref: string): number => indexOfRef.get(ref) ?? Number.MAX_SAFE_INTEGER;
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const item of items) {
    dependents.set(item.clientRef, []);
    indegree.set(item.clientRef, 0);
  }

  for (const item of items) {
    const seen = new Set<string>();
    for (const dependency of item.dependsOn) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      if (!indexOfRef.has(dependency)) {
        return {
          ok: false,
          reason: 'missing_dependency',
          clientRef: item.clientRef,
          missing: dependency,
        };
      }
      const waiting = dependents.get(dependency);
      if (waiting === undefined) {
        return {
          ok: false,
          reason: 'missing_dependency',
          clientRef: item.clientRef,
          missing: dependency,
        };
      }
      waiting.push(item.clientRef);
      indegree.set(item.clientRef, (indegree.get(item.clientRef) ?? 0) + 1);
    }
  }

  const ready: string[] = [];
  for (const item of items) {
    if ((indegree.get(item.clientRef) ?? 0) === 0) ready.push(item.clientRef);
  }

  const orderedRefs: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) break;
    orderedRefs.push(next);
    const waiting = dependents.get(next) ?? [];
    for (const clientRef of waiting) {
      const remaining = (indegree.get(clientRef) ?? 0) - 1;
      indegree.set(clientRef, remaining);
      if (remaining === 0) insertByOriginalIndex(ready, clientRef, indexOf);
    }
  }

  if (orderedRefs.length !== items.length) return { ok: false, reason: 'cycle' };

  const byRef = new Map(items.map((item) => [item.clientRef, item]));
  const ordered: BatchIngestItem[] = [];
  for (const clientRef of orderedRefs) {
    const item = byRef.get(clientRef);
    if (item !== undefined) ordered.push(item);
  }

  return {
    ok: true,
    items: ordered,
    acknowledgements: ordered.map((item) => ({ clientRef: item.clientRef, status: 'planned' })),
  };
}

/** A push event, as far as ordering is concerned. `dependsOn` entries are event ids. */
export interface PushEventRef {
  eventId: string;
  dependsOn: readonly string[];
}

export type PushEventOrder<T extends PushEventRef> =
  | { ok: true; events: T[] }
  | { ok: false; reason: 'cycle' | 'duplicate_event' };

/**
 * Apply order for one push batch.
 *
 * Only `dependsOn` ids that are also event ids in this batch are edges. An id
 * from an earlier batch is not a missing dependency here — the route checks
 * those against already-accepted events and can still return a receipt.
 * Duplicate event ids and cycles order nothing. The input array is not mutated.
 */
export function orderPushEvents<T extends PushEventRef>(events: readonly T[]): PushEventOrder<T> {
  const present = new Set<string>();
  for (const event of events) {
    if (present.has(event.eventId)) return { ok: false, reason: 'duplicate_event' };
    present.add(event.eventId);
  }

  const planned = planBatchIngest(events.map((event) => ({
    clientRef: event.eventId,
    entityType: 'event',
    operation: 'apply',
    dependsOn: event.dependsOn.filter((id) => present.has(id)),
  })));
  if (!planned.ok) {
    if (planned.reason === 'duplicate_client_ref') return { ok: false, reason: 'duplicate_event' };
    return { ok: false, reason: 'cycle' };
  }

  const byId = new Map(events.map((event) => [event.eventId, event]));
  const ordered: T[] = [];
  for (const item of planned.items) {
    const event = byId.get(item.clientRef);
    if (event !== undefined) ordered.push(event);
  }
  return { ok: true, events: ordered };
}
