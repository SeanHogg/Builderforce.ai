/**
 * Per-entity sync status for chat, ticket, audit, and run (G23).
 *
 * The device read lives in `@builderforce/local-first` `deriveSyncStatus`.
 * This module does not cache a second status and does not read a `syncStatus`
 * field already on the entity. Status is that entity's pending events only.
 */
import {
  deriveSyncStatus,
  type StoreSyncStatus,
  type SyncStatusStore,
  type SyncStatusStoreEvent,
} from "@builderforce/local-first";

/** Any local chat, ticket, audit, or run. Only `id` is read. */
export interface SyncStatusEntity {
  readonly id: string;
}

function eventsFor(entity: SyncStatusEntity, store: SyncStatusStore): readonly SyncStatusStoreEvent[] {
  return (store.events ?? []).filter((event) => event.clientEntityId === entity.id);
}

/**
 * Derived status for this entity. Other entities' events are not an input.
 * A `syncStatus` already on `entity` is not an input.
 */
export function statusFor(entity: SyncStatusEntity, store: SyncStatusStore): StoreSyncStatus {
  const events = eventsFor(entity, store);
  const eventIds = new Set(
    events.flatMap((event) => (event.eventId === undefined ? [] : [event.eventId])),
  );
  return deriveSyncStatus({
    reachable: store.reachable,
    events,
    receipts: (store.receipts ?? []).filter((receipt) => eventIds.has(receipt.eventId)),
    conflicts: (store.conflicts ?? []).filter((conflict) => conflict.clientEntityId === entity.id),
  });
}

/**
 * A new object with `syncStatus` stamped from the store. The input is not mutated.
 */
export function stamp<T extends SyncStatusEntity>(
  entity: T,
  store: SyncStatusStore,
): Omit<T, "syncStatus"> & { readonly syncStatus: StoreSyncStatus } {
  return { ...entity, syncStatus: statusFor(entity, store) };
}
