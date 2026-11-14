/**
 * The run delta card's lifecycle in the chat (PRD 41 §C11.1): a run whose delta starts computing gets a `pending` card AT
 * ONCE ("Measuring what this run changed…"), each computed delta replaces it, and a computation that ends without one (an
 * error, the budget) leaves a `failed` card instead — a card never sits pending forever. `run-delta/get` answers the same:
 * the stored cards, plus the progress card of a run this session is still measuring (or failed to).
 *
 * Also where a card's anchor comes from: {@link lastReplySince}, the last assistant message the run persisted.
 */
/** Failed cards are kept for this session's `run-delta/get`, at most this many runs. */
const MAX_TRACKED = 100;
/** The id of the last assistant message persisted at or after `since` (the run's start), or undefined when it wrote none. */
export function lastReplySince(messages, since) {
    const from = Date.parse(since);
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== "assistant")
            continue;
        const at = Date.parse(m.createdAt);
        if (Number.isNaN(from) || Number.isNaN(at) || at >= from)
            return m.id;
        return undefined; // the newest reply predates the run: it wrote none
    }
    return undefined;
}
export function createRunDeltaProgress(relay) {
    const runs = new Map();
    /** The runs being measured now: whether each has posted a computed card yet. Only these are tracked — a computed card
     *  posted again later (a release's re-post) must not leave an entry nobody removes. */
    const measuring = new Map();
    const post = (card) => {
        if (card.status !== "pending" && card.status !== "failed") {
            if (measuring.has(card.runId))
                measuring.set(card.runId, true);
            runs.delete(card.runId);
        }
        relay(card);
    };
    return {
        post,
        begin({ repos, ...run }) {
            if (repos <= 0)
                return () => { };
            const pending = { ...run, status: "pending" };
            runs.set(run.runId, pending);
            while (runs.size > MAX_TRACKED)
                runs.delete(runs.keys().next().value);
            measuring.set(run.runId, false);
            relay(pending);
            let over = false;
            return () => {
                if (over)
                    return;
                over = true;
                const computed = measuring.get(run.runId) === true;
                measuring.delete(run.runId);
                if (computed)
                    return;
                const failed = { ...run, status: "failed" };
                runs.set(run.runId, failed);
                relay(failed);
            };
        },
        dynamic(runId, minutes) {
            const card = runs.get(runId);
            if (!card || card.status !== "pending" || !(minutes > 0))
                return;
            const next = { ...card, dynamicMinutes: Math.max(card.dynamicMinutes ?? 0, Math.ceil(minutes)) };
            runs.set(runId, next);
            relay(next);
        },
        withProgress(query, stored) {
            if (query.runId === undefined && query.chatId === undefined)
                return [...stored];
            const has = new Set(stored.map((c) => c.runId));
            const progress = [...runs.values()].filter((c) => !has.has(c.runId) && (query.runId === undefined || c.runId === query.runId) && (query.chatId === undefined || c.chatId === query.chatId));
            return [...stored, ...progress];
        },
    };
}
//# sourceMappingURL=runDeltaProgress.js.map