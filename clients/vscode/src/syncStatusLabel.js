import { statusFor } from "./entitySyncState";
/**
 * `statusFor` keeps events whose clientEntityId matches the entity. This
 * helper has no entity, so a copy is addressed to one id and the original
 * list is left untouched.
 */
const EVENTS_ONLY_ID = "events";
function eventsOnly(events) {
    return events.map((event) => ({
        eventId: event.eventId,
        clientEntityId: EVENTS_ONLY_ID,
        entityType: event.entityType,
        unsent: event.unsent,
        pending: event.pending,
        conflict: event.conflict,
        inConflict: event.inConflict,
        sent: event.sent,
        state: event.state,
        status: event.status,
        deadLetter: event.deadLetter,
    }));
}
/** idle → Local, pending → Waiting to sync, conflict → Needs review. Anything else → Local. */
export function labelFor(events) {
    const status = statusFor({ id: EVENTS_ONLY_ID }, { reachable: true, events: eventsOnly(events) });
    if (status === "pending")
        return "Waiting to sync";
    if (status === "conflict")
        return "Needs review";
    return "Local";
}
//# sourceMappingURL=syncStatusLabel.js.map