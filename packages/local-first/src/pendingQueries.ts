/**
 * Reads over the PENDING journal events, through a transaction (split out of `store.ts`).
 *
 * The one place "which events still have work to do" is answered: a selection (`selectPending`,
 * `selectPendingOf` — cloned, sequence order, dead letters skipped), a row's events through the
 * per-row index (`scanPendingOfRow`), and the counts a drain reads (`countPending` exact,
 * `countLivePending` a lookup).
 */

import { SYNC_PASS_BIND_TYPES, bySequence, loadMappedEntities, unsendableEventIds } from './dependencyGraph.js';
import { destinationKey, type EntityDestination, type JournalEvent, type LocalEntityType } from './records.js';
import { SCAN_STOP, type LocalFirstTransaction, type ScanPendingVisit } from './storeContract.js';
import { clone } from './clone.js';

/**
 * Pending events for which `where` holds, in sequence order, cloned — only the matches.
 * A dead-lettered event (a permanent refusal the server will never accept) is NOT pending
 * work: it stays in the journal for audit and status, but is skipped here so it can neither
 * be re-sent nor starve the events behind it.
 */
export async function selectPending(
  tx: LocalFirstTransaction,
  where?: (event: Readonly<JournalEvent>) => boolean,
  destination?: EntityDestination,
): Promise<JournalEvent[]> {
  const matches: JournalEvent[] = [];
  await tx.scanPending((event) => {
    if (event.deadLetter) return;
    if (!where || where(event)) matches.push(event as JournalEvent);
  }, destination);
  matches.sort(bySequence);
  return clone(matches);
}

/**
 * Visit ONE row's pending events (`clientEntityId`) without cloning — the per-row index
 * (`LocalFirstTransaction.scanPendingOf`), or a filtered `scanPending` for a transaction
 * without one. Same view rules and `SCAN_STOP` as `scanPending`.
 */
export async function scanPendingOfRow(
  tx: LocalFirstTransaction,
  clientEntityId: string,
  visit: ScanPendingVisit,
  destination?: EntityDestination,
): Promise<void> {
  if (tx.scanPendingOf) return tx.scanPendingOf(clientEntityId, visit, destination);
  return tx.scanPending((event) => (event.clientEntityId === clientEntityId ? visit(event) : undefined), destination);
}

/** `selectPending` of ONE row (`scanPendingOfRow`): its live events of `entityType` for which `where` holds. */
export async function selectPendingOf(
  tx: LocalFirstTransaction,
  entityType: LocalEntityType,
  clientEntityId: string,
  where?: (event: Readonly<JournalEvent>) => boolean,
  destination?: EntityDestination,
): Promise<JournalEvent[]> {
  const matches: JournalEvent[] = [];
  await scanPendingOfRow(tx, clientEntityId, (event) => {
    if (event.deadLetter || event.entityType !== entityType) return;
    if (!where || where(event)) matches.push(event as JournalEvent);
  }, destination);
  matches.sort(bySequence);
  return clone(matches);
}

/**
 * How many events still have work to do for `destination` (all when omitted): the pending
 * journal minus the dead-lettered, the blocked and those awaiting a bind.
 */
export async function countPending(tx: LocalFirstTransaction, destination?: EntityDestination): Promise<number> {
  // The usual case is a count, not a walk: with no dead letter anywhere nothing is BLOCKED, and
  // with no row of a sync-bound type still waiting in the unbound partition nothing AWAITS A BIND —
  // so every live event counts, and the store keeps that number per partition.
  const counted = tx.pendingCount?.(destination);
  if (counted && counted.dead === 0 && !(await hasRowAwaitingBind(tx))) return counted.live;
  // Blocked events (behind a dead-lettered write that nothing replaced) are not work either:
  // they cannot be sent until the user supersedes that write, so they must not hold a drain open.
  // Nor are events waiting on an entity the next sync pass binds: only that bind releases them.
  const every: JournalEvent[] = [];
  await tx.scanPending((event) => { every.push(event as JournalEvent); });
  const blocked = unsendableEventIds(every, await loadMappedEntities(tx, every));
  const key = destination ? destinationKey(destination) : undefined;
  return every.filter((event) => !event.deadLetter && !blocked.has(event.eventId)
    && (key === undefined || destinationKey(event.destination) === key)).length;
}

/**
 * Live (not dead-lettered) pending events for `destination` — a lookup of the store's
 * per-partition count, never a walk. Unlike `countPending` it still counts events that are
 * blocked or awaiting a bind: what a drain loop checks between rounds, where "a round sent
 * nothing" already ends the loop, and where a walk per round cost seconds on a long queue.
 */
export async function countLivePending(tx: LocalFirstTransaction, destination?: EntityDestination): Promise<number> {
  const counted = tx.pendingCount?.(destination);
  if (counted) return counted.live;
  let live = 0;
  await tx.scanPending((event) => { if (!event.deadLetter) live += 1; }, destination);
  return live;
}

/**
 * A live, device-written row of a type the sync pass binds, still in the unbound partition — the
 * graph's AWAITING BIND (`dependencyGraph.ts`). With none, no pending event can await a bind.
 * One early-exit scan, no clone.
 */
export async function hasRowAwaitingBind(tx: LocalFirstTransaction): Promise<boolean> {
  let found = false;
  for (const type of SYNC_PASS_BIND_TYPES) {
    await tx.scan(type, (row) => {
      if (row.destination.kind === 'unbound' && !row.deletedAt && row.provenance?.source !== 'imported') {
        found = true;
        return SCAN_STOP;
      }
    });
    if (found) return true;
  }
  return false;
}
