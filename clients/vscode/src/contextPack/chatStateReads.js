/**
 * The chat's linked tickets and runs, read HOST-side for the context pack (PRD 35 E2),
 * through the ONE shared reader (`readChatTicketLinks` / `readChatRunHistory` in
 * brain-embedded — the panel's chat-tickets adapter reads the same routes through it).
 * What is the pack's own: the cap on how many it lists, the fields it renders, and that
 * a failure is a missing part ([] / null), never a failed run.
 */
import { readChatRunHistory, readChatTicketLinks } from "@seanhogg/builderforce-brain-embedded";
import { authed } from "../bfApi";
/** Tickets / runs a pack lists — the newest work is what a planner needs. */
const MAX_TICKETS = 25;
const MAX_RUNS = 15;
function getVia(secrets) {
    return (path) => authed(secrets, path);
}
/** The chat's tickets — [] on any failure (a pack part is optional). */
export async function readChatTickets(secrets, chatId) {
    try {
        const tickets = await readChatTicketLinks(getVia(secrets), chatId);
        return tickets.slice(0, MAX_TICKETS).map((t) => ({
            kind: String(t.kind ?? ""),
            ref: String(t.ref ?? ""),
            label: String(t.label ?? ""),
            status: String(t.status ?? ""),
            ...(typeof t.progressPct === "number" ? { progressPct: t.progressPct } : {}),
        }));
    }
    catch {
        return [];
    }
}
/** The chat's runs — null when the history could not be read (never "nothing ran"). */
export async function readChatRuns(secrets, chatId) {
    try {
        const r = await readChatRunHistory(getVia(secrets), chatId);
        if (!r || !Array.isArray(r.runs))
            return null;
        return r.runs.slice(0, MAX_RUNS).map((run) => ({
            executionId: Number(run.executionId ?? 0),
            taskTitle: run.taskTitle ?? null,
            agentName: run.agentName ?? null,
            status: String(run.status ?? ""),
            executor: run.executor ?? null,
            errorMessage: run.errorMessage ?? null,
        }));
    }
    catch {
        return null;
    }
}
/** Both reads, in parallel. */
export async function readChatState(secrets, chatId) {
    const [tickets, runs] = await Promise.all([readChatTickets(secrets, chatId), readChatRuns(secrets, chatId)]);
    return { tickets, runs };
}
//# sourceMappingURL=chatStateReads.js.map