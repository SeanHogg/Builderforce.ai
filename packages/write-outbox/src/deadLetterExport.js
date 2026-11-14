/**
 * User-visible dead-letter export and repair plan.
 *
 * Given dead-letter records, produce a JSON-serializable export and a plan
 * that says which entries can be requeued. Requeue is durable queues only,
 * and only when a payload is present. Best-effort entries, and any entry
 * with no payload, stay dead. The callable repair is
 * `exportAndRequeueDeadLetter` in `./deadLetterRepair.ts`.
 */
import { classifyUserWorkQueue } from "./queueClass.js";
const SUMMARY_LIMIT = 160;
function clip(value, limit) {
    if (value.length <= limit)
        return value;
    return `${value.slice(0, limit)}…`;
}
function queueNameOf(record) {
    if (typeof record.queue === "string" && record.queue.trim() !== "")
        return record.queue.trim();
    if (typeof record.key === "string" && record.key.trim() !== "")
        return record.key.trim();
    return "";
}
function reasonOf(record) {
    const fromLetter = record.deadLetter?.reason;
    if (typeof fromLetter === "string" && fromLetter.trim() !== "")
        return fromLetter;
    if (typeof record.reason === "string")
        return record.reason;
    return "";
}
function occurredAtOf(record) {
    const fromLetter = record.deadLetter?.at;
    if (typeof fromLetter === "string" && fromLetter.trim() !== "")
        return fromLetter;
    if (typeof record.occurredAt === "string")
        return record.occurredAt;
    return "";
}
/**
 * The body a repair may resend. An explicit `payload` property, even null,
 * wins over `item` so a stripped body cannot be repaired from a stale item.
 */
function bodyOf(record) {
    if ("payload" in record) {
        const value = record.payload;
        return { present: value !== undefined && value !== null, value };
    }
    if ("item" in record && record.item !== undefined && record.item !== null) {
        return { present: true, value: record.item };
    }
    return { present: false, value: undefined };
}
function summarizePayload(value) {
    if (value === undefined || value === null)
        return "";
    if (typeof value === "string")
        return clip(value, SUMMARY_LIMIT);
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (typeof value === "bigint")
        return String(value);
    try {
        const json = JSON.stringify(value);
        if (typeof json !== "string")
            return "";
        return clip(json, SUMMARY_LIMIT);
    }
    catch {
        return "[unserializable]";
    }
}
/**
 * Known queue names win over a retention stamp. A live constructor that
 * built diagnostics telemetry as durable must not be repaired as user work.
 * An unknown queue may still use an explicit retention; otherwise it stays
 * unclassified and is not requeued.
 */
function retentionOf(record, queue) {
    const classified = classifyUserWorkQueue(queue);
    if (classified)
        return classified.retention;
    if (record.retention === "durable" || record.retention === "best-effort")
        return record.retention;
    return "unclassified";
}
function decide(record) {
    const queue = queueNameOf(record);
    const retention = retentionOf(record, queue);
    const body = bodyOf(record);
    const id = typeof record.id === "string" ? record.id : "";
    if (!body.present) {
        return { id, queue, retention, action: "stay-dead", why: "missing-payload" };
    }
    if (retention === "best-effort") {
        return { id, queue, retention, action: "stay-dead", why: "best-effort" };
    }
    if (retention !== "durable" || id.trim() === "") {
        return { id, queue, retention, action: "stay-dead", why: "unclassified" };
    }
    return { id, queue, retention, action: "requeue" };
}
/**
 * Export dead letters and plan which ones a user may repair.
 * Does not mutate `records`, send anything, or delete a letter.
 */
export function exportDeadLetterAction(records) {
    const entries = [];
    const requeue = [];
    const stayDead = [];
    for (const record of records) {
        const body = bodyOf(record);
        entries.push({
            id: typeof record.id === "string" ? record.id : "",
            queue: queueNameOf(record),
            reason: reasonOf(record),
            occurredAt: occurredAtOf(record),
            payloadSummary: summarizePayload(body.present ? body.value : undefined),
        });
        const decision = decide(record);
        if (decision.action === "requeue")
            requeue.push(decision);
        else
            stayDead.push(decision);
    }
    return { entries, repair: { requeue, stayDead } };
}
//# sourceMappingURL=deadLetterExport.js.map