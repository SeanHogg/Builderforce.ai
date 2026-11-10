/**
 * Compare's "before" in the editor (PRD 41 §C9): the platform's previous review of a root, marked
 * `comparable` by memory's ONE `comparable()` — the same rules the web analysis compare and the run
 * delta use. A side not comparable shows its findings as "present now", never as resolved.
 *
 * The meta of each side is what it can state for itself:
 *   - the packs that measured it (`tools`: a pack measured on one side only is `tool-missing:<pack>`,
 *     so its findings never read as fixed), from the stored graph's `scope.packs` and the packs this
 *     editor reviews with;
 *   - the content-hash rule (`contentHashRule`): this editor's `CONTENT_HASH_RULE`; a stored graph
 *     records none, which memory reads as the baseline rule;
 *   - the root (`scope`).
 * A stored graph records no extractor version, so none is compared (an unknown is not a mismatch).
 */

import { comparable, CONTENT_HASH_RULE, type ComparabilityMeta, type KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";

/** A side's meta from its packs, its root and its content-hash rule (absent ⇒ memory's baseline rule). */
export function knowledgeSideMeta(side: { rootId: string; packs: readonly string[]; contentHashRule?: string }): ComparabilityMeta {
  return {
    scope: side.rootId,
    tools: Object.fromEntries([...new Set(side.packs)].map((pack) => [pack, ""])),
    ...(side.contentHashRule ? { contentHashRule: side.contentHashRule } : {}),
  };
}

/** The baseline the view compares against: the stored graph, comparable exactly when memory's `comparable()` finds no reason. */
export function knowledgeBaseline(before: KnowledgeGraph, after: { rootId: string; packs: readonly string[] }): { graph: KnowledgeGraph; comparable: boolean } {
  const verdict = comparable(
    knowledgeSideMeta({ rootId: before.scope.rootId, packs: before.scope.packs }),
    knowledgeSideMeta({ ...after, contentHashRule: CONTENT_HASH_RULE }),
  );
  return { graph: before, comparable: verdict.comparable };
}
