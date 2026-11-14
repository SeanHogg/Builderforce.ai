/**
 * Sub-agents journaled WITH the run that started them, so no child vanishes with the editor
 * (chat #61651: six children died when the editor closed and the resumed parent never
 * learned they had existed).
 *
 *   - {@link recordRunChildren}: a run's children (`PersistedChild`, from the ledger in
 *     `childLedger.ts`) written onto THAT run's `execution` record as `children`. Every later
 *     write to the record (`runRecovery.ts` checkpoints, finish, recovery) spreads the
 *     payload, so the list rides along into the `interrupted` record.
 *   - {@link persistChildrenTo}: that write as the ledger's `persist` port. Each child is
 *     keyed to its OWNING run, captured when it is first journaled (at spawn): the chat's
 *     live run then. A child that settles after the person sent a new message is written to
 *     the run that started it — never the chat's newer run, which would leave the owner's
 *     record saying `running` (a false resume offer, `leftInFlight`) and copy earlier runs'
 *     children onto later records.
 *   - {@link interruptedChildrenOf}: what a resumed parent is told about each child, as DATA
 *     (`InterruptedChildView`); `interruptedResumeTurn.ts` words it in the person's language.
 *
 * No journal event is appended: like a checkpoint, the child list is local resume state,
 * not a lifecycle transition to mirror.
 */
import { childReportText } from "@builderforce/agent-tools";
import { selectRecords } from "@builderforce/local-first";
import { renderInterruptedChildren, RESUME_TURN_DEFAULTS } from "./interruptedResumeTurn";
/** How many times a children write is retried when another writer moved the record under it. */
export const CHILDREN_WRITE_ATTEMPTS = 4;
const isVersionConflict = (error) => error?.code === "ENTITY_VERSION_CONFLICT";
/**
 * Write `children` onto a run's execution record: `runId`'s when given (the owning run), else the chat's latest (a host
 * that does not know the owner). A run that is not journaled is left alone. Retried on a version conflict — a checkpoint
 * or finish of the same record landing in between — so the final settle is never lost to a race. Returns the run written.
 */
export async function recordRunChildren(store, args) {
    for (let attempt = 1;; attempt += 1) {
        try {
            return await writeChildren(store, args);
        }
        catch (error) {
            if (!isVersionConflict(error) || attempt >= CHILDREN_WRITE_ATTEMPTS)
                throw error;
        }
    }
}
async function writeChildren(store, args) {
    const at = (args.now?.() ?? new Date()).toISOString();
    return store.transact(async (tx) => {
        const run = args.runId
            ? (await tx.get("execution", args.runId)) ?? undefined
            : latestRun(await selectRecords(tx, "execution", (r) => String(r.payload.chatId ?? "") === args.chatId));
        if (!run)
            return undefined;
        // Unchanged: no write, so re-journaling a chat's older runs costs nothing.
        if (JSON.stringify(run.payload.children ?? []) === JSON.stringify(args.children))
            return run.id;
        await tx.put({ ...run, version: run.version + 1, updatedAt: at, payload: { ...run.payload, children: [...args.children] } }, run.version);
        return run.id;
    });
}
/** A live run beats a settled one; otherwise the most recently written. */
function latestRun(runs) {
    const rank = (r) => (r.payload.status === "running" ? 1 : 0);
    return [...runs].sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt))[0];
}
/** The chat's run a newly journaled child belongs to: its live run (the one spawning), else its latest. */
async function owningRunOf(store, chatId) {
    return store.read(async (tx) => latestRun(await selectRecords(tx, "execution", (r) => String(r.payload.chatId ?? "") === chatId))?.id);
}
/**
 * {@link recordRunChildren} as the ledger's `persist` port (`createChildLedger`): each child is keyed to the run that
 * owned it when it was first journaled, and every run's record carries exactly its own children.
 */
export function persistChildrenTo(store, now) {
    /** `chat:handle` → the owning run id. Handles are unique per chat for the session (`childRuns.ts`). */
    const owners = new Map();
    const keyOf = (chatId, child) => `${chatId}:${child.handle}`;
    return async (rootChatId, children) => {
        const chatId = String(rootChatId);
        if (children.some((child) => !owners.has(keyOf(chatId, child)))) {
            const runId = await owningRunOf(store, chatId);
            if (runId)
                for (const child of children)
                    if (!owners.has(keyOf(chatId, child)))
                        owners.set(keyOf(chatId, child), runId);
        }
        const byRun = new Map();
        for (const child of children) {
            const runId = owners.get(keyOf(chatId, child));
            if (!runId)
                continue;
            byRun.set(runId, [...(byRun.get(runId) ?? []), child]);
        }
        for (const [runId, own] of byRun)
            await recordRunChildren(store, { chatId, runId, children: own, ...(now ? { now } : {}) });
    };
}
/** The children journaled with a run record. */
export function childrenOfRecord(record) {
    const children = record.payload.children;
    return Array.isArray(children) ? children : [];
}
/** What a child that died with the editor tells its resumed owner (the English default of `ir.childInterrupted`). */
export const INTERRUPTED_CHILD_NOTE = RESUME_TURN_DEFAULTS["ir.childInterrupted"];
/**
 * The sub-agents an interrupted run had started, as the data its resume renders: a running child keeps its brief (it died
 * with the editor), a finished one its report unless `wait_agents` already returned it. Empty when the run started none.
 */
export function interruptedChildrenOf(record) {
    return childrenOfRecord(record).map((c) => ({
        handle: c.handle,
        label: c.label,
        owner: c.owner,
        ...(c.ticket ? { ticket: c.ticket } : {}),
        state: c.state,
        ...(c.deliveredBy ? { deliveredBy: c.deliveredBy } : {}),
        ...(c.state === "running" ? { brief: c.brief } : {}),
        ...(c.state !== "running" && c.deliveredBy !== "wait" && c.report ? { report: childReportText(c.report) } : {}),
    }));
}
const english = (_key, fallback) => fallback;
/** {@link interruptedChildrenOf} worded for the resumed parent (`renderInterruptedChildren`); English unless `t` is given. */
export function describeInterruptedChildren(record, t = english) {
    return renderInterruptedChildren(t, interruptedChildrenOf(record));
}
//# sourceMappingURL=childRunJournal.js.map