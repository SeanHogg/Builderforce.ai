/**
 * Per-entity sync status for chat, ticket, audit, and run (G23).
 *
 * The device read lives in `@builderforce/local-first` `deriveSyncStatus`.
 * This module does not cache a second status and does not read a `syncStatus`
 * field already on the entity. Status is that entity's pending events only.
 */
import { deriveSyncStatus, } from "@builderforce/local-first";
function eventsFor(entity, store) {
    return (store.events ?? []).filter((event) => event.clientEntityId === entity.id);
}
/**
 * Derived status for this entity. Other entities' events are not an input.
 * A `syncStatus` already on `entity` is not an input.
 */
export function statusFor(entity, store) {
    const events = eventsFor(entity, store);
    const eventIds = new Set(events.flatMap((event) => (event.eventId === undefined ? [] : [event.eventId])));
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
export function stamp(entity, store) {
    return { ...entity, syncStatus: statusFor(entity, store) };
}
//# sourceMappingURL=entitySyncState.js.map