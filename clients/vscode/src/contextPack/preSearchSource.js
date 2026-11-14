/**
 * The run's DETERMINISTIC pre-turn parts (cost levers, WS-L), all from the workspace's
 * definition index + ripgrep, none calling a model:
 *
 *   - the pre-search hits block appended to the context pack (below);
 *   - the "where is X defined?" answer the run adopts instead of calling a model.
 *
 * The hits block also carries the knowledge index's part (`knowledgeSource.ts`): recalled
 * beside the searches under the same deadline, minus the files the hits already name.
 *
 * Both are also the PreFetch gate's first registry rows (`prefetch/vscodePrefetchPort.ts`),
 * which ask the SAME memoized computation (`preSearchOnce`, `whereDefinedOnce`).
 *
 * The context pack's PRE-SEARCH part: the identifiers the request
 * names, looked up in the workspace's definition index and searched with ripgrep before
 * turn 1 — a bounded hits block, no model call. Kept beside, not inside,
 * `buildContextPack.ts`: the pack's own fan-out is untouched, and the hits are appended as
 * their own section (`withPreSearch`), under the same ~1.5 s deadline.
 *
 * Pure Node (no `vscode` import).
 */
import { answerWhereDefined, preSearch, whereDefinedTargets } from "@builderforce/agent-tools";
import { findRipgrep } from "../ripgrep";
import { searchWorkspace } from "../workspaceSearch";
import { workspaceSymbolIndex } from "../workspaceSymbols";
import { REQUEST_SYMBOL_LIMIT } from "./requestSymbols";
import { knowledgePart, knowledgeRecall, preSearchPaths } from "./knowledgeSource";
import { withinMs } from "./withinMs";
/** The hits block for `request` in the workspace at `root`, '' when none or later than
 *  `deadlineMs` (the pack's own deadline, `CONTEXT_PACK_DEADLINE_MS`). At the deadline
 *  (or on Stop) every ripgrep the pre-search started is killed — none outlives the pack. */
export async function preSearchBlock(root, request, deadlineMs, opts = {}) {
    if (!request.trim())
        return "";
    // No folder open: nothing to search, but a loaded knowledge pack still has its part (`knowledgeSource.ts`).
    if (!root)
        return knowledgePart(await knowledgeRecall("", request, deadlineMs, opts.signal ? { signal: opts.signal } : {}), new Set());
    // Aborted the moment the race settles — at the deadline at the latest — or on Stop.
    const stop = new AbortController();
    const onStop = () => stop.abort(opts.signal?.reason);
    if (opts.signal?.aborted)
        stop.abort(opts.signal.reason);
    else
        opts.signal?.addEventListener("abort", onStop, { once: true });
    try {
        const symbols = opts.symbols ?? workspaceSymbolIndex(root);
        const ripgrep = findRipgrep().catch(() => null);
        // The knowledge index's recall starts beside the searches, under the same deadline.
        const knowledge = knowledgeRecall(root, request, deadlineMs, { signal: stop.signal });
        const work = preSearch(request, {
            findSymbol: (name) => symbols.find(name, { limit: REQUEST_SYMBOL_LIMIT }),
            searchText: async (query, signal) => searchWorkspace({ root, start: root, query, ripgrep: await ripgrep, ...(signal ? { signal } : {}) }),
        }, { signal: stop.signal });
        const [hits, recalled] = await Promise.all([withinMs(work, deadlineMs, undefined), knowledge]);
        return [hits?.block ?? "", knowledgePart(recalled, preSearchPaths(hits))].filter(Boolean).join("\n\n");
    }
    finally {
        opts.signal?.removeEventListener("abort", onStop);
        // Done or late, anything still searching is no longer wanted: kill it.
        stop.abort(new Error("pre-search settled"));
    }
}
/**
 * The model-free answer to "where is X defined?" (`answerWhereDefined`) when the index
 * resolves every name the request asks about; undefined otherwise, or when the index
 * cannot answer within `deadlineMs` — the run then proceeds to the model as before.
 */
export function whereDefinedAnswer(root, request, deadlineMs) {
    if (!root || !whereDefinedTargets(request))
        return Promise.resolve(undefined);
    const work = answerWhereDefined(request, (name) => workspaceSymbolIndex(root).find(name, { limit: 50 })).then((a) => a ?? undefined);
    return withinMs(work, deadlineMs, undefined);
}
/**
 * ONE computation per request, however many parts ask: the run's context pack, the
 * native participant's turn context, the PreFetch gate's executors and the participant's
 * reference read all ask about the SAME request within one submit. A single slot, keyed
 * by workspace and request and held only for {@link ONCE_TTL_MS} — the next request (or
 * the same words asked again later, against a workspace that may have changed) computes
 * afresh. The first caller's deadline and options stand.
 */
const ONCE_TTL_MS = 30_000;
function onceFor(compute) {
    let last;
    return (root, request, ...rest) => {
        const key = JSON.stringify([root, request]);
        const now = Date.now();
        if (last?.key !== key || now - last.at > ONCE_TTL_MS)
            last = { key, at: now, value: compute(root, request, ...rest) };
        return last.value;
    };
}
/** {@link preSearchBlock}, once per request. */
export const preSearchOnce = onceFor(preSearchBlock);
/** {@link whereDefinedAnswer}, once per request. */
export const whereDefinedOnce = onceFor(whereDefinedAnswer);
/** The pack with the hits appended as their own section; a pack of only hits when the
 *  pack itself had nothing to build from. */
export async function withPreSearch(pack, hits) {
    const [built, block] = await Promise.all([pack, hits.catch(() => "")]);
    if (!block)
        return built;
    if (!built)
        return { block, recallHint: "", servedReads: [] };
    return { ...built, block: built.block ? `${built.block}\n\n${block}` : block };
}
//# sourceMappingURL=preSearchSource.js.map