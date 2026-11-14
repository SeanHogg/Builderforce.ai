import { deriveRecordSyncStatus, hasServerMapping, syncShownAsDone, } from "@builderforce/local-first";
export const PRESENTED_SYNC_STATUSES = ["pending", "syncing", "synced", "conflict", "dead-letter"];
/** Highest precedence first. Index 0 wins. */
export const PRESENTED_SYNC_PRECEDENCE = [
    "dead-letter",
    "conflict",
    "syncing",
    "pending",
    "synced",
];
function precedenceRank(status) {
    const rank = PRESENTED_SYNC_PRECEDENCE.indexOf(status);
    if (rank < 0)
        throw new Error(`sync_status_unknown:${status}`);
    return rank;
}
/**
 * Pick one code. Dead-letter beats conflict, which beats syncing, which beats
 * pending, which beats synced. Input order does not matter.
 */
export function preferPresentedSyncStatus(statuses) {
    const winner = statuses.reduce((best, status) => {
        if (!best || precedenceRank(status) < precedenceRank(best))
            return status;
        return best;
    }, undefined);
    if (!winner)
        throw new Error("sync_status_required");
    return winner;
}
/** Map the store model. `local` is presented as `pending`; the other codes pass through. */
export function presentDerivedSyncStatus(status) {
    return status === "local" ? "pending" : status;
}
/**
 * The store model hides a dead letter behind an open conflict. Ask it again
 * with the conflict facts removed so presentation can put the dead letter first.
 */
function deadLetterAsideFromConflict(input) {
    return (deriveRecordSyncStatus({
        record: input.record,
        events: input.events,
        receipts: (input.receipts ?? []).filter((receipt) => receipt.status !== "conflict"),
        conflicts: [],
        mapped: input.mapped,
    }) === "dead-letter");
}
/**
 * Status for one store record and its journal facts.
 * Events, receipts, and conflicts for other records are ignored by the store model.
 */
export function presentSyncStatus(input) {
    const derived = presentDerivedSyncStatus(deriveRecordSyncStatus(input));
    const statuses = [derived];
    if (derived !== "dead-letter" && deadLetterAsideFromConflict(input))
        statuses.push("dead-letter");
    return preferPresentedSyncStatus(statuses);
}
/**
 * The ONE way a row's status is read from the store's facts, given the record itself (no scan).
 * Every event, receipt and conflict goes in: the store model keeps only this record's
 * (`receiptsFor` in local-first), so a receipt for another record never moves this one (C7).
 * The store's mappings decide `mapped`: a record the server holds whose events (and any receipt
 * that predates the entity fields) are gone is still synced.
 */
export function presentRecordSyncStatus(facts, record) {
    return presentSyncStatus({
        record,
        events: facts.events,
        receipts: facts.receipts,
        conflicts: facts.conflicts,
        mapped: hasServerMapping(record, facts.mappings),
    });
}
function toStoreStatus(status) {
    return status === "pending" ? "local" : status;
}
/** A denied, conflicting, or dead-lettered sync is not done. Delegates to the store rule. */
export function presentedSyncShownAsDone(record, status) {
    return syncShownAsDone(record, toStoreStatus(status));
}
//# sourceMappingURL=syncStatusPresenter.js.map