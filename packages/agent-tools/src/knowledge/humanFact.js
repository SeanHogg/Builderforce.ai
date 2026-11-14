/**
 * knowledge/humanFact.ts — **Add fact** (PRD 38 §3.7): what a person asserts about a node,
 * as the batch a `KnowledgeStore` writes. One rule for every host: the key is derived from
 * the node and the words (so the same note twice is one fact), a source node anchors the
 * fact by its path (`file_anchors`), and any other node is linked by an `about` relation.
 * Pure.
 */
import { factRef, pathOfRef, sha256Hex, } from '@seanhogg/builderforce-memory/knowledge';
/** Where Add-fact notes say they came from. */
export const HUMAN_FACT_SOURCE = 'knowledge-graph';
const HUMAN_FACT_IMPORTANCE = 0.6;
export function humanFactKey(ref, content) {
    return `note:${sha256Hex(`${ref}\u0000${content}`).slice(0, 24)}`;
}
export function humanFactBatch(args) {
    const { scope, ref, content } = args;
    const key = humanFactKey(ref, content);
    const path = pathOfRef(ref);
    return {
        scope,
        facts: [{ key, content, source: HUMAN_FACT_SOURCE, importance: HUMAN_FACT_IMPORTANCE, origin: 'human', fileAnchors: path ? [{ path }] : [] }],
        relations: path ? [] : [{ from: factRef(key), to: ref, kind: 'about', weight: 1, origin: 'human' }],
    };
}
//# sourceMappingURL=humanFact.js.map