/**
 * One push round of the sync coordinator: PICK the next batch (read), then MATERIALIZE it
 * (one commit) — `sync.ts` sends what this returns.
 *
 * PICK costs the batch, not the queue. The general algorithm (`unsendableEventIds` +
 * `wireDependencies` + `batchEvents`) indexes, resolves and checks EVERY pending event: ~5 s a
 * round on a store with 88k queued imports, so draining it took hours of the editor's thread.
 * With the store's own indexes (`LocalFirstTransaction.pendingLookup`) the batch is found by
 * walking the partition in `batchEvents`' order (fresh work, then held events) and deciding each
 * event on its own: its dependencies resolved against those indexes (`storeDependencyIndex`), the
 * store facts read only for it (`MappedFacts`), and BLOCKED / AWAITING BIND / behind-a-HELD-write
 * followed per event (`stuckCheck`, memoized). The walk stops at the batch limits. A dependent of
 * a skipped event is skipped too: what it waits on is pending and not selected. A transaction
 * without the indexes takes the general algorithm, unchanged.
 *
 * MATERIALIZE turns the picked record-payload markers into events carrying the record's payload
 * (`recordPayloadMarker.ts`) and COMMITS that before the push, so a resend after a lost response
 * carries the bytes the server already hashed. A marker whose row is gone is acknowledged — there
 * is nothing left to import (as `queueImport` sends nothing for a deleted row).
 */

import type { EntityDestination, JournalEvent, LocalRecord } from './records.js';
import { destinationKey } from './records.js';
import { SCAN_STOP, type LocalFirstTransaction, type PendingLookup } from './storeContract.js';
import {
  MappedFacts,
  loadMappedEntities,
  resolveDependency,
  storeDependencyIndex,
  unsendableEventIds,
  type DependencyIndex,
} from './dependencyGraph.js';
import { backingOff, batchEvents, jsonBytes, wireDependencies, wireEvent } from './syncBatch.js';
import { partitionUnboundPending, type UnboundSyncRefusal } from './creationDestination.js';
import { importPayload } from './journalRules.js';
import { isRecordPayloadMarker, materializedEvent } from './recordPayloadMarker.js';
import { clone } from './clone.js';

export interface RoundLimits {
  readonly maxEvents: number;
  readonly maxBytes: number;
  /** Now, in ms: held events wait out their backoff. */
  readonly at: number;
}

export interface PickedRound {
  /** Cloned, wired; record-payload markers still markers (`materializeRound` fills them). */
  readonly batch: JournalEvent[];
  readonly refused: UnboundSyncRefusal[];
}

/** Pick the next batch for `destination` (see the module comment). Read-only. */
export async function pickRound(tx: LocalFirstTransaction, destination: EntityDestination, limits: RoundLimits): Promise<PickedRound> {
  const key = destinationKey(destination);
  const lookup = tx.pendingLookup?.();
  if (!lookup) return pickGeneral(tx, key, limits);
  const isHeld = (event: JournalEvent): boolean => (event.holdAttempts ?? 0) > 0;

  // A first look at the head of the queue: the journal keeps its events in sequence order, so the
  // next batch is almost always among the first fresh events — read just those, not the queue.
  const head: JournalEvent[] = [];
  let truncated = false;
  await tx.scanPending((event) => {
    if (event.deadLetter || isHeld(event)) return;
    if (head.length >= HEAD_WINDOW) { truncated = true; return SCAN_STOP; }
    head.push(event as JournalEvent);
  }, destination);
  if (truncated) {
    head.sort(bySequence);
    const picked = await walk(tx, key, lookup, head, limits);
    // Only a FULL batch from the head is the batch: held events come after fresh work anyway.
    if (picked.full) return { batch: picked.batch, refused: picked.refused };
  }

  // The whole partition, in `batchEvents`' order: fresh work first, held events after it.
  const partition: JournalEvent[] = [];
  await tx.scanPending((event) => { if (!event.deadLetter) partition.push(event as JournalEvent); }, destination);
  partition.sort(bySequence);
  const ordered = [...partition.filter((event) => !isHeld(event)), ...partition.filter(isHeld)];
  const picked = await walk(tx, key, lookup, ordered, limits);
  return { batch: picked.batch, refused: picked.refused };
}

/** Fresh events read for the first look at a round (`pickRound`). */
const HEAD_WINDOW = 1000;
const bySequence = (a: JournalEvent, b: JournalEvent): number => a.localSequence - b.localSequence;

/** Decide each candidate in order (see the module comment) until the batch limits. */
async function walk(
  tx: LocalFirstTransaction,
  key: string,
  lookup: PendingLookup,
  candidates: readonly JournalEvent[],
  limits: RoundLimits,
): Promise<{ batch: JournalEvent[]; refused: UnboundSyncRefusal[]; full: boolean }> {
  const facts = new MappedFacts();
  const index: DependencyIndex = storeDependencyIndex(lookup, facts.mapped);
  const { syncable, refused } = partitionUnboundPending(candidates);
  const stuck = stuckCheck(tx, index, facts);
  // Pending in THIS partition and live: a dependency the batch must carry first.
  const pendingHere = (eventId: string): boolean => {
    const event = lookup.byId(eventId);
    return !!event && !event.deadLetter && destinationKey(event.destination) === key;
  };
  const batch: JournalEvent[] = [];
  const selected = new Set<string>();
  let bytes = 0;
  let full = false;
  for (const event of syncable) {
    if (batch.length >= limits.maxEvents) { full = true; break; }
    if (backingOff(event, limits.at)) continue;
    // Blocked behind a dead letter, waiting on an entity the next pass binds, or behind a HELD
    // write (the server would only hold it too): not sendable now.
    if (await stuck(event)) continue;
    const wired = wireEvent(event, index);
    // A dependent never goes up ahead of what it waits on: a skipped dependency is pending here
    // and not selected, so its dependents are skipped with it.
    if (wired.dependsOn.some((id) => pendingHere(id) && !selected.has(id))) continue;
    // Same byte rule as `batchEvents`. A marker is sized once it is filled (`materializeRound`).
    const size = jsonBytes(wired);
    if (batch.length > 0 && bytes + size > limits.maxBytes) { full = true; break; }
    batch.push(wired);
    selected.add(event.eventId);
    bytes += size;
    if (size > limits.maxBytes) { full = true; break; }
  }
  if (batch.length >= limits.maxEvents) full = true;
  return { batch: clone(batch), refused, full };
}

/**
 * Whether an event cannot be sent because of what it (transitively) depends on: a dead letter
 * (`blocked`), an entity awaiting its bind, or a held write. Resolved per event and memoized, so
 * a round costs the events it considers — the per-event form of `unsendableEventIds` (+ the
 * held rule of `batchEvents`), followed into other partitions too.
 */
function stuckCheck(tx: LocalFirstTransaction, index: DependencyIndex, facts: MappedFacts): (event: JournalEvent) => Promise<boolean> {
  const memo = new Map<string, boolean>();
  const visit = async (event: JournalEvent, depth: number): Promise<boolean> => {
    const known = memo.get(event.eventId);
    if (known !== undefined) return known;
    memo.set(event.eventId, false); // a cycle is not stuck by itself
    await facts.load(tx, [event], index);
    let result = false;
    for (const dependency of event.dependsOn) {
      const resolved = resolveDependency(dependency, index, event);
      if (resolved.kind === 'blocked' || resolved.kind === 'awaiting-bind') { result = true; break; }
      if (resolved.kind !== 'event' || resolved.event.eventId === event.eventId) continue;
      if ((resolved.event.holdAttempts ?? 0) > 0) { result = true; break; }
      if (depth < 64 && await visit(resolved.event, depth + 1)) { result = true; break; }
    }
    memo.set(event.eventId, result);
    return result;
  };
  return (event) => visit(event, 0);
}

/** The general algorithm, over every pending event (a transaction without the store's indexes). */
async function pickGeneral(tx: LocalFirstTransaction, key: string, limits: RoundLimits): Promise<PickedRound> {
  const every: JournalEvent[] = [];
  await tx.scanPending((event) => { every.push(event as JournalEvent); });
  every.sort((a, b) => a.localSequence - b.localSequence);
  // A dependent of a dead-lettered write is BLOCKED (not sent, not counted) until a new live
  // event appears under that key; it needs no state change of its own to become sendable.
  // Likewise a dependent of an entity whose record still awaits the sync pass's bind.
  const mapped = await loadMappedEntities(tx, every);
  const blocked = unsendableEventIds(every, mapped);
  const sendable = every.filter((event) => !event.deadLetter && !blocked.has(event.eventId)
    && destinationKey(event.destination) === key);
  // G10: an unbound event parked in the bound partition (a record rebound without its events, or a
  // destination smuggled onto an unbound value) is refused here, not pushed and not dropped.
  const { syncable, refused } = partitionUnboundPending(wireDependencies(sendable, every, mapped));
  const picked = batchEvents(syncable, limits.maxEvents, limits.maxBytes, limits.at);
  return { batch: clone(picked.batch), refused };
}

export interface MaterializedRound {
  /** What to push: every event carries its payload. A prefix of the picked batch within the byte limit. */
  readonly batch: JournalEvent[];
  readonly bytes: number;
}

/**
 * Inside a transaction: fill the picked markers from their records and commit them (see the
 * module comment), drop the ones whose row is gone, and trim the batch to `maxBytes` (never below
 * one event). Events that are no longer pending (another commit acknowledged or replaced them
 * since the pick) are left out, and so is everything after the first one left out, so a
 * dependent never goes up without what it depends on.
 */
export async function materializeRound(tx: LocalFirstTransaction, picked: readonly JournalEvent[], maxBytes: number): Promise<MaterializedRound> {
  const out: JournalEvent[] = [];
  const gone: string[] = [];
  let bytes = 0;
  for (const wired of picked) {
    const current = tx.pendingLookup ? tx.pendingLookup().byId(wired.eventId) : (await tx.pending()).find((event) => event.eventId === wired.eventId);
    if (!current) break;
    // As it is NOW (another commit may have filled it since the pick), with the wired dependencies.
    let wire: JournalEvent = { ...current, dependsOn: wired.dependsOn };
    if (isRecordPayloadMarker(current)) {
      // Filling a marker without committing it would let a resend carry other bytes than the
      // first push: a transaction that cannot persist it must not send it.
      if (!tx.materializeEvent) throw new Error('record_payload_marker_needs_materialize_event');
      const record = await tx.get(current.entityType, current.clientEntityId);
      if (!record || record.deletedAt) {
        // Nothing left to import. Its dependents were wired to it: stop here, so none of them goes
        // up this round — the next round resolves the acknowledged dependency as satisfied.
        gone.push(current.eventId);
        break;
      }
      const payload = await recordPayloadOf(tx, current, record);
      const filled = materializedEvent(current, payload);
      wire = { ...filled, dependsOn: wired.dependsOn };
      const size = jsonBytes(wire);
      if (out.length > 0 && bytes + size > maxBytes) break;
      await tx.materializeEvent(current.eventId, payload);
      out.push(wire);
      bytes += size;
      continue;
    }
    const size = jsonBytes(wire);
    if (out.length > 0 && bytes + size > maxBytes) break;
    out.push(clone(wire));
    bytes += size;
  }
  if (gone.length > 0) await tx.acknowledge(gone);
  return { batch: out, bytes };
}

/** An import is the row as the server should adopt it (`importPayload`); any other write is the row. */
async function recordPayloadOf(tx: LocalFirstTransaction, event: JournalEvent, record: LocalRecord): Promise<unknown> {
  if (event.operation !== 'import') return record.payload;
  return importPayload(record, await tx.mapping(record.entityType, record.id, record.destination));
}

/**
 * The payload `event` goes up with if it were sent now: its own, or — for a record-payload
 * marker — the one read from its record (undefined when the row is gone). Read-only.
 */
export async function sendablePayload(tx: LocalFirstTransaction, event: JournalEvent): Promise<unknown> {
  if (!isRecordPayloadMarker(event)) return event.payload;
  const record = await tx.get(event.entityType, event.clientEntityId);
  return record && !record.deletedAt ? recordPayloadOf(tx, event, record) : undefined;
}
