/**
 * The context pack's KNOWLEDGE part (docs/design/deterministic-knowledge-index.md,
 * "Consumers"): the workspace root's knowledge index asked about the request — exact +
 * lexical hits (dense only while an embedder is warm), expanded one hop over the graph's
 * neighbours — rendered with paths into the pack's volatile tail, beside the pre-search
 * hits (`preSearchSource.ts` wires both under the SAME deadline).
 *
 * Recall and rendering are split so the pre-search can start both at once and still drop
 * every knowledge hit whose file the pre-search already names. Late, failed or empty ⇒ no
 * part, never a run failure. Pure Node (no `vscode` import).
 */
import { knowledgeSubject, renderKnowledgeContext, } from "@builderforce/agent-tools/knowledge-index";
import { workspaceKnowledgeIndex } from "../knowledge/index/hostKnowledgeIndex";
import { withLoadedPacks } from "../knowledge/packs/packIndexing";
import { withinMs } from "./withinMs";
/** Hits the part carries — a pointer list, not a dump. */
export const KNOWLEDGE_PART_HITS = 6;
/** The index's recall for `request`, or undefined when there is none within `deadlineMs` (or on Stop). */
export function knowledgeRecall(root, request, deadlineMs, opts = {}) {
    if (!request.trim() || opts.signal?.aborted)
        return Promise.resolve(undefined);
    const query = knowledgeSubject(request) ?? request.trim();
    // No folder open is no workspace index, not no knowledge: the loaded packs still answer.
    const work = withLoadedPacks(root ? (opts.index ?? workspaceKnowledgeIndex)(root) : undefined)
        .recall(query, { k: KNOWLEDGE_PART_HITS })
        .then((recall) => (recall.hits.length ? { query, recall } : undefined))
        .catch(() => undefined);
    const stopped = new Promise((resolve) => opts.signal?.addEventListener("abort", () => resolve(undefined), { once: true }));
    return withinMs(Promise.race([work, stopped]), deadlineMs, undefined);
}
/** The files the pre-search already names — the knowledge part leaves them out. */
export function preSearchPaths(r) {
    return new Set([...(r?.definitions ?? []), ...(r?.references ?? [])].map((x) => x.path));
}
/** The knowledge part, '' when nothing new is left after the pre-search's files. */
export function knowledgePart(k, exclude) {
    if (!k)
        return "";
    return renderKnowledgeContext(k.query, k.recall.hits, k.recall.tiers, { exclude, max: KNOWLEDGE_PART_HITS });
}
//# sourceMappingURL=knowledgeSource.js.map