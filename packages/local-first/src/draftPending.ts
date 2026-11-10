/**
 * A transaction's view of the PENDING events through the store's indexes (split out of
 * `storeTransaction.ts`): by row (`PendingEntityIndex`), by idempotency key (`PendingKeyIndex`)
 * and the per-partition counts (`PendingCounts`) — each the committed index plus what the draft
 * appended, every hit read back through the draft so an acknowledged event is gone and a held /
 * re-appended / materialized one is seen as it is now.
 */

import { destinationKey, type EntityDestination, type JournalEvent } from './records.js';
import { SCAN_STOP, type PendingCount, type PendingLookup, type ScanPendingVisit } from './storeContract.js';
import type { PendingCounts, PendingEntityIndex, PendingKeyIndex } from './storeState.js';

export interface DraftPendingSources {
  /** The event as the draft sees it now (undefined: acknowledged / unknown). */
  current(eventId: string): JournalEvent | undefined;
  readonly committed: { readonly pendingEntities: PendingEntityIndex; readonly pendingKeys: PendingKeyIndex; readonly pendingCounts: PendingCounts };
  readonly added: { readonly entities: PendingEntityIndex; readonly keys: PendingKeyIndex; readonly counts: PendingCounts };
}

/** Visit one row's pending events (destination `key`, or every partition). Stops at `SCAN_STOP`. */
export function visitPendingOf(sources: DraftPendingSources, clientEntityId: string, visit: ScanPendingVisit, key: string | undefined): void {
  const seen = new Set<string>();
  for (const ids of [sources.committed.pendingEntities.of(clientEntityId), sources.added.entities.of(clientEntityId)]) {
    for (const eventId of ids ?? []) {
      if (seen.has(eventId)) continue;
      seen.add(eventId);
      const event = sources.current(eventId);
      if (!event || event.clientEntityId !== clientEntityId) continue;
      if (key !== undefined && destinationKey(event.destination) !== key) continue;
      if (visit(event) === SCAN_STOP) return;
    }
  }
}

export function draftPendingCount(sources: DraftPendingSources, destination?: EntityDestination): PendingCount {
  const { pendingCounts } = sources.committed;
  const { counts } = sources.added;
  const live = destination
    ? pendingCounts.live(destinationKey(destination)) + counts.live(destinationKey(destination))
    : pendingCounts.liveTotal() + counts.liveTotal();
  return { live, dead: pendingCounts.dead() + counts.dead() };
}

export function draftPendingLookup(sources: DraftPendingSources): PendingLookup {
  return {
    byId: (eventId) => sources.current(eventId),
    byKey: (key) => {
      const seen = new Set<string>();
      const out: JournalEvent[] = [];
      for (const list of [sources.committed.pendingKeys.all(key), sources.added.keys.all(key)]) {
        for (const filed of list) {
          if (seen.has(filed.eventId)) continue;
          seen.add(filed.eventId);
          const event = sources.current(filed.eventId);
          if (event && event.idempotencyKey === key) out.push(event);
        }
      }
      return out;
    },
    byEntity: (clientEntityId) => {
      const out: JournalEvent[] = [];
      visitPendingOf(sources, clientEntityId, (event) => { out.push(event); }, undefined);
      return out;
    },
  };
}
