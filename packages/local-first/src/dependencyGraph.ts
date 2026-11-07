/**
 * The journal's dependency graph, resolved at SEND time.
 *
 * `dependsOn` is stored as the author wrote it: an idempotency KEY (`project:p:import`) or, for
 * an older stored event, a wire event id. A key names a LOGICAL write, not one event: when the
 * write is replaced (a bound row's pending import is dropped and re-queued under a new id), the
 * key follows the replacement. Freezing the key to the old event's id at append left dependents
 * waiting on an id that no longer exists, so nothing here is resolved until a batch is built.
 *
 * Pure. No store, no network.
 */

import { isJournalEventId } from './storeContract.js';
import type { JournalEvent } from './records.js';

const bySequence = (a: JournalEvent, b: JournalEvent): number => a.localSequence - b.localSequence;

/** The live (not dead-lettered) pending events by key (latest wins) and by id. */
function liveIndex(all: readonly JournalEvent[]): { byKey: Map<string, JournalEvent>; byId: Map<string, JournalEvent> } {
  const byKey = new Map<string, JournalEvent>();
  const byId = new Map<string, JournalEvent>();
  for (const event of [...all].sort(bySequence)) {
    if (event.deadLetter) continue;
    byId.set(event.eventId, event);
    if (event.idempotencyKey !== undefined) byKey.set(event.idempotencyKey, event);
  }
  return { byKey, byId };
}

/**
 * The wire id a dependency names RIGHT NOW: the current live event under a key, or a live event
 * of that id. `undefined` means nothing pending is named: the dependency was acknowledged (or
 * replaced away), so there is nothing left to wait for.
 */
export function currentDependencyId(
  dependency: string,
  index: { byKey: ReadonlyMap<string, JournalEvent>; byId: ReadonlyMap<string, JournalEvent> },
): string | undefined {
  const byKey = index.byKey.get(dependency);
  if (byKey) return byKey.eventId;
  return isJournalEventId(dependency) ? index.byId.get(dependency)?.eventId : undefined;
}

export function liveDependencyIndex(all: readonly JournalEvent[]) {
  return liveIndex(all);
}

/**
 * Live events that cannot be sent because something they (transitively) depend on was
 * DEAD-LETTERED and has no live replacement under its key. They are blocked, not dead-lettered:
 * the moment a new live event appears for that key (the user fixes and re-saves the row) the
 * dependency resolves to it and they are sendable again with no state change of their own.
 */
export function blockedEventIds(all: readonly JournalEvent[]): Set<string> {
  const { byKey, byId } = liveIndex(all);
  const deadKeys = new Set<string>();
  const deadIds = new Set<string>();
  for (const event of all) {
    if (!event.deadLetter) continue;
    if (event.idempotencyKey !== undefined && byKey.has(event.idempotencyKey)) continue; // replaced by a live event
    deadIds.add(event.eventId);
    if (event.idempotencyKey !== undefined) deadKeys.add(event.idempotencyKey);
  }
  const blocked = new Set<string>();
  if (deadKeys.size === 0 && deadIds.size === 0) return blocked;
  const live = [...byId.values()].sort(bySequence);
  for (let changed = true; changed;) {
    changed = false;
    for (const event of live) {
      if (blocked.has(event.eventId)) continue;
      const stuck = event.dependsOn.some((dependency) => {
        if (deadKeys.has(dependency)) return true;
        if (isJournalEventId(dependency)) {
          if (deadIds.has(dependency)) return true;
          return blocked.has(dependency);
        }
        const target = byKey.get(dependency);
        return target !== undefined && blocked.has(target.eventId);
      });
      if (stuck) {
        blocked.add(event.eventId);
        changed = true;
      }
    }
  }
  return blocked;
}
