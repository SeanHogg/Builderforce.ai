/**
 * Classify a queue as durable user work or best-effort telemetry.
 *
 * User work is retained until acknowledged. Telemetry-class queues may be
 * dropped on failure. A name this table does not own is unclassified — it is
 * not guessed. This module does not construct a queue and does not rewrite a
 * live constructor.
 */
import { classifyOutboxWork } from "./classification.js";
import { classifyUserWorkQueue } from "./queueClass.js";
/**
 * Telemetry-class plural aliases the user-work queue table does not own.
 * `qa-capture` and `visitor-journey` themselves are classified there and are
 * deliberately absent from this table, so there is one owner per name.
 */
const EXTRA_TELEMETRY = {
    "qa-captures": "qa-capture",
    "visitor-journeys": "visitor-journey",
};
/** Singular aliases of the work-kind table, mapped onto its canonical ids. */
const WORK_CANONICAL = {
    history: "history",
    histories: "history",
    ticket: "tickets",
    tickets: "tickets",
    audit: "audits",
    audits: "audits",
    fact: "facts",
    facts: "facts",
    telemetry: "telemetry",
};
function normalizeQueueName(name) {
    return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}
function classified(queue, retention, kind) {
    return {
        queue,
        retention,
        onFailure: retention === "durable" ? "retain-until-acked" : "drop-on-failure",
        kind,
    };
}
/**
 * Mark a user-work queue durable and a telemetry-class queue best-effort.
 * Unknown, empty, or non-string names are unclassified.
 */
export function classifyQueue(name) {
    const fromQueue = classifyUserWorkQueue(name);
    if (fromQueue) {
        return classified(fromQueue.queue, fromQueue.retention, fromQueue.retention === "durable" ? "user-work" : "telemetry");
    }
    const fromWork = classifyOutboxWork(name);
    if (fromWork && typeof name === "string") {
        const key = normalizeQueueName(name);
        const queue = WORK_CANONICAL[key];
        if (queue)
            return classified(queue, fromWork, fromWork === "durable" ? "user-work" : "telemetry");
    }
    if (typeof name !== "string")
        return undefined;
    const key = normalizeQueueName(name);
    if (!key)
        return undefined;
    const extra = EXTRA_TELEMETRY[key];
    if (extra)
        return classified(extra, "best-effort", "telemetry");
    return undefined;
}
/** True only for a queue this helper marks as durable user work. */
export function isDurableUserWorkQueue(name) {
    return classifyQueue(name)?.kind === "user-work";
}
/** True only for a telemetry-class queue this helper marks best-effort. */
export function isTelemetryQueue(name) {
    return classifyQueue(name)?.kind === "telemetry";
}
//# sourceMappingURL=classifyQueue.js.map