/**
 * Sealed batches — how a lane's queued entries become the batch a send carries.
 *
 * A batch is taken first in, first out, and SEALED the first time it is taken: each entry
 * is tagged with the batch's key (the first entry's id) and the current scope, so a retry
 * re-sends exactly the same entries under the same key and the same identity. A sealed
 * batch is always re-taken whole; an unsealed one takes up to `maxItems` due entries.
 */
import { batchIdempotencyKey } from "./idempotency.js";
export const bySeq = (a, b) => a.seq - b.seq;
/** May `e` be sent under `scope`? Unscoped entries go under any scope. */
export function sendable(e, scope) {
    return !e.deadLetter && (scope === undefined || e.scope === undefined || e.scope === scope);
}
/**
 * Take the next batch of `scope`'s entries off a lane (first in, first out), sealing it
 * if it is not sealed yet. Entries of another scope stay where they are, parked. Only
 * entries queued up to `upTo` (a `seq` watermark) are taken: a flush sends what was
 * queued when it was ASKED for, and anything queued later waits for its own trigger —
 * or rides along with a drain.
 *
 * `sealed` is true when this call sealed the batch, i.e. the caller must persist it.
 */
export function takeBatch(l, scope, upTo, maxItems) {
    const due = (e) => e.seq <= upTo && sendable(e, scope);
    const start = l.entries.findIndex(due);
    if (start < 0)
        return null;
    const head = l.entries[start];
    let n = 0;
    const at = (i) => l.entries[start + i];
    if (head.batch) {
        while (at(n) && at(n).batch === head.batch)
            n += 1;
    }
    else {
        while (at(n) && n < maxItems && !at(n).batch && due(at(n)))
            n += 1;
    }
    const batch = l.entries.splice(start, n);
    const sealed = !head.batch;
    if (sealed) {
        for (const e of batch) {
            e.batch = head.id;
            if (scope !== undefined)
                e.scope = scope;
        }
    }
    return { batch, sealed };
}
/** What a send of `batch` is handed besides `final`. */
export function sendContext(batch) {
    const head = batch[0];
    return {
        idempotencyKey: batchIdempotencyKey(batch),
        ids: batch.map((e) => e.id),
        ...(head.scope !== undefined ? { scope: head.scope } : {}),
    };
}
/** What a drain request is handed: the taken entries' key (or a fresh one when none rode along). */
export function drainContext(taken, scope, newId) {
    return {
        idempotencyKey: batchIdempotencyKey(taken) ?? newId(),
        ids: taken.map((e) => e.id),
        ...(scope ? { scope } : {}),
    };
}
//# sourceMappingURL=sealedBatch.js.map