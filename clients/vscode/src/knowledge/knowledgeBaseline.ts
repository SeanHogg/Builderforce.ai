/**
 * Compare's "before" in the editor (PRD 41 §C9): the platform's previous review of a root, marked
 * `comparable` by memory's ONE `comparable()` — the same rules the web analysis compare and the run
 * delta use. A side not comparable shows its findings as "present now", never as resolved.
 *
 * The meta of each side is what it can state for itself:
 *   - the packs that measured it (`tools`: a pack measured on one side only is `tool-missing:<pack>`,
 *     so its findings never read as fixed), from the stored graph's `scope.packs` and the packs this
 *     editor reviews with;
 *   - the analyzer versions (also `tools`, name → version) and the extractor version: the platform's
 *     as stored with that review (`previousToolVersions` / `previousExtractorVersion` of the root's
 *     scope), this editor's from agent-tools `knowledgeMeasuredWith` — the same values its uploads state;
 *   - the content-hash rule (`contentHashRule`): this editor's `CONTENT_HASH_RULE`; a stored graph
 *     records none, which memory reads as the baseline rule;
 *   - the root (`scope`).
 *
 * A review the platform stored before it recorded versions states none. That is an UNKNOWN, and C9
 * never presents an unknown producer as the same one ("missing analyzer output must never be presented
 * as a fix"): memory's `comparable()` compares an absent field equal only to an absent one, so such a
 * baseline is `extractor-version-changed` / `tool-missing:<tool>` — not comparable — until the root is
 * reviewed again.
 */

import { comparable, CONTENT_HASH_RULE, type ComparabilityMeta, type KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { knowledgeMeasuredWith } from "@builderforce/agent-tools/knowledge";

/** What a review was measured with, as far as it is known (absent = unknown). */
export interface MeasuredWith {
  extractorVersion?: string;
  toolVersions?: Readonly<Record<string, string>>;
}

/** A side's meta from its packs, its root, its content-hash rule (absent ⇒ memory's baseline rule) and what it was measured with. */
export function knowledgeSideMeta(side: { rootId: string; packs: readonly string[]; contentHashRule?: string } & MeasuredWith): ComparabilityMeta {
  return {
    scope: side.rootId,
    tools: { ...Object.fromEntries([...new Set(side.packs)].map((pack) => [pack, ""])), ...side.toolVersions },
    ...(side.extractorVersion !== undefined ? { extractorVersion: side.extractorVersion } : {}),
    ...(side.contentHashRule ? { contentHashRule: side.contentHashRule } : {}),
  };
}

/**
 * The baseline the view compares against: the stored graph, comparable exactly when memory's `comparable()` finds no
 * reason. `measured` is what the platform stored for that review (absent fields = unknown).
 */
export function knowledgeBaseline(
  before: KnowledgeGraph, measured: MeasuredWith, after: { rootId: string; packs: readonly string[] },
): { graph: KnowledgeGraph; comparable: boolean } {
  const verdict = comparable(
    knowledgeSideMeta({ rootId: before.scope.rootId, packs: before.scope.packs, ...measured }),
    knowledgeSideMeta({ ...after, ...knowledgeMeasuredWith(after.packs), contentHashRule: CONTENT_HASH_RULE }),
  );
  return { graph: before, comparable: verdict.comparable };
}
