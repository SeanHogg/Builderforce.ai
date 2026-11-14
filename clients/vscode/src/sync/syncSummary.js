/**
 * The sync summary (G23), derived from the local store on every read — never cached, never
 * a second status. It answers: where does this device send (mode and destination), what is
 * waiting (queued items and their bytes), what needs a person (conflicts, dead letters), and
 * when the platform last took a push and last answered a pull.
 *
 * Local completion never waits on any of this: the summary is a READ of what the journal
 * already holds, so a denied or offline platform changes the numbers, never what finished.
 *
 * Pure over a snapshot (`buildSyncSummary`), with one async reader (`readSyncSummary`) that
 * takes its facts and its last-pull time from ports. No `vscode`, no network.
 */
import { isRecordPayloadFence } from "@builderforce/local-first";
const encoder = new TextEncoder();
/** The destination a person recognises: the workspace, else the account, else the platform host. */
export function summaryDestination(destination) {
    if (!destination || destination.kind !== "bound")
        return { kind: "unbound" };
    const label = destination.tenantId ?? destination.accountId ?? destination.platformInstance;
    return label ? { kind: "bound", label } : { kind: "unbound" };
}
function payloadBytes(payload) {
    try {
        return encoder.encode(JSON.stringify(payload) ?? "").length;
    }
    catch {
        return 0;
    }
}
export function buildSyncSummary(facts, context) {
    let items = 0;
    let bytes = 0;
    let deadLetters = 0;
    for (const event of facts.events) {
        // The record-payload fence is no failed write: it only holds older builds off markers.
        if (isRecordPayloadFence(event))
            continue;
        if (event.deadLetter) {
            deadLetters += 1;
            continue;
        }
        // An unbound write journals a MARKER (no payload) that is never sent: nothing is waiting on it
        // until a bind replaces it with a real import, which counts then.
        if (event.destination?.kind !== "bound")
            continue;
        items += 1;
        bytes += payloadBytes(event.payload);
    }
    let lastPushAt;
    for (const receipt of facts.receipts) {
        if (receipt.status !== "accepted" && receipt.status !== "duplicate")
            continue;
        if (lastPushAt === undefined || receipt.receivedAt > lastPushAt)
            lastPushAt = receipt.receivedAt;
    }
    return {
        mode: context.mode,
        destination: summaryDestination(context.destination),
        queued: { items, bytes },
        conflicts: facts.conflicts.filter((conflict) => !conflict.resolvedAt).length,
        deadLetters,
        ...(lastPushAt !== undefined ? { lastPushAt } : {}),
        ...(context.lastPullAt !== undefined ? { lastPullAt: context.lastPullAt } : {}),
    };
}
export async function readSyncSummary(ports) {
    const destination = ports.destination();
    const [facts, lastPullAt] = await Promise.all([
        ports.facts(),
        destination ? ports.lastPullAt(destination) : Promise.resolve(undefined),
    ]);
    return buildSyncSummary(facts, { mode: ports.mode(), destination, lastPullAt });
}
//# sourceMappingURL=syncSummary.js.map