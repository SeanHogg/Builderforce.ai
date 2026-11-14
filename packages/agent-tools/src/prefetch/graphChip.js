/**
 * The **Open in graph** chip — ONE builder for every answer that points at the knowledge
 * graph (the code-pack findings, `knowledge.ask`, `/graph`, the end of a review), so each
 * carries the same command, label and arguments (`rootId` and the focus refs) and a host
 * routes them with one rule (`knowledgeChipIntent`).
 */
/** The command that opens the knowledge-graph view (registered by the editor's graph view). */
export const OPEN_KNOWLEDGE_GRAPH_COMMAND = 'builderforce.openKnowledgeGraph';
/** The chip's label key in every host catalog. */
export const OPEN_IN_GRAPH_LABEL_KEY = 'prefetch.chip.openInGraph';
/** The most refs a chip focuses. */
export const CHIP_FOCUS_MAX = 50;
/** The chip that opens the graph of `rootId` (when known) focused on `focus` (`src:<root>::<path>`, `ent:…`, `fact:…`). */
export function openInGraphChip(args) {
    return {
        labelKey: OPEN_IN_GRAPH_LABEL_KEY,
        command: OPEN_KNOWLEDGE_GRAPH_COMMAND,
        args: { ...(args.rootId ? { rootId: args.rootId } : {}), focus: [...args.focus].slice(0, CHIP_FOCUS_MAX) },
    };
}
/** What a host's `showGraph` answers: its text and the ONE Open-in-graph chip, carrying the root and the focus refs. */
export function graphShown(text, rootId, focus) {
    return { text, chip: openInGraphChip({ rootId, focus }) };
}
//# sourceMappingURL=graphChip.js.map