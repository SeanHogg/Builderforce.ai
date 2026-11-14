/**
 * The VSIX snapshot CACHE file (`local-first-v1.json`) — classification only.
 *
 * The journal is the commit (`localFirstJournalIo.ts`); this file is a
 * republished cache and a one-way legacy import. Nothing here opens a file:
 * these functions classify text a caller already read, and decide what to keep
 * when it cannot be trusted. Split out of `localFirstStore.ts`.
 */
import { isLocalFirstSnapshot } from "@builderforce/local-first";
/** Stable name for a snapshot file that exists but cannot be trusted. */
export const LOCAL_FIRST_SNAPSHOT_CORRUPT = "local_first_snapshot_corrupt";
/** Thrown after the bad file has been copied aside. `message` includes `recoveryPath`. */
export class LocalFirstSnapshotCorruptError extends Error {
    recoveryPath;
    constructor(recoveryPath) {
        super(`${LOCAL_FIRST_SNAPSHOT_CORRUPT}: ${recoveryPath}`);
        this.name = LOCAL_FIRST_SNAPSHOT_CORRUPT;
        this.recoveryPath = recoveryPath;
    }
}
/** `…/local-first-v1.json` → `…/local-first-v1.json.corrupt-<timestamp>`. */
export function corruptSnapshotRecoveryPath(snapshotPath, timestamp) {
    return `${snapshotPath}.corrupt-${timestamp}`;
}
/**
 * Classify the text of a snapshot file that already exists.
 * Invalid JSON, or a shape `isLocalFirstSnapshot` rejects, is `preserve`: the
 * caller keeps the bytes at `recoveryPath` (the store moves the cache aside and
 * opens from the journal; `loadExistingSnapshot` copies it and throws).
 * Classification does not invent an empty snapshot from the bad bytes.
 */
export function planSnapshotLoad(text, snapshotPath, timestamp) {
    const recoveryPath = corruptSnapshotRecoveryPath(snapshotPath, timestamp);
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { action: "preserve", recoveryPath, error: new LocalFirstSnapshotCorruptError(recoveryPath) };
    }
    if (!isLocalFirstSnapshot(value)) {
        return { action: "preserve", recoveryPath, error: new LocalFirstSnapshotCorruptError(recoveryPath) };
    }
    return { action: "use", snapshot: value };
}
/**
 * Load a present snapshot. On parse or shape failure, copy the original file to
 * `local-first-v1.json.corrupt-<timestamp>` and throw. A corrupt file is not
 * opened as an empty store, and the original is left in place so the next open
 * fails closed instead of succeeding with nothing.
 */
export async function loadExistingSnapshot(text, snapshotPath, timestamp, copyCorruptFile) {
    const plan = planSnapshotLoad(text, snapshotPath, timestamp);
    if (plan.action === "preserve") {
        await copyCorruptFile(snapshotPath, plan.recoveryPath);
        throw plan.error;
    }
    return structuredClone(plan.snapshot);
}
/** True when a snapshot carries anything worth importing. */
export function snapshotHasState(snapshot) {
    return snapshot.records.length > 0
        || snapshot.events.length > 0
        || snapshot.mappings.length > 0
        || snapshot.receipts.length > 0
        || snapshot.conflicts.length > 0
        || Object.keys(snapshot.cursors).length > 0
        || snapshot.nextSequence !== 1;
}
//# sourceMappingURL=localFirstSnapshotFile.js.map