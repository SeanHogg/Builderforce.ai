/**
 * Compare's "before" in the editor (PRD 41 §C9): the platform's previous review of a root, judged by agent-tools
 * `knowledgeComparability` — memory's ONE `comparable()`, the same rule the web baseline applies. A side not
 * comparable shows its findings as "present now", never as resolved, and the view shows WHY (`reasons`).
 *
 * Each side states what ITS review recorded when it ran (`ScopeRecord.measured`), never this host's versions now:
 *   - before: the stored graph's packs and the platform's `previousMeasured` for that review;
 *   - after: the shown graph's review — this machine's local scope when the root is here (hashed by this editor's
 *     `CONTENT_HASH_RULE`), else the platform's latest scope.
 * A review that recorded none (stored before versions were recorded) is UNKNOWN, never "the same".
 */

import { CONTENT_HASH_RULE, type ComparabilityReason, type KnowledgeGraph, type MeasuredWith } from "@seanhogg/builderforce-memory/knowledge";
import { knowledgeComparability } from "@builderforce/agent-tools/knowledge";

/** The after side: its root, packs, what its review recorded, and whether this editor hashed it (`local`). */
export interface BaselineAfter { rootId: string; packs: readonly string[]; measured: MeasuredWith | undefined; local: boolean }

/** The baseline the view compares against, with memory's verdict and its reasons. */
export function knowledgeBaseline(
  before: KnowledgeGraph, measured: MeasuredWith | undefined, after: BaselineAfter,
): { graph: KnowledgeGraph; comparable: boolean; reasons: ComparabilityReason[] } {
  const verdict = knowledgeComparability(
    { rootId: before.scope.rootId, packs: before.scope.packs, measured },
    { rootId: after.rootId, packs: after.packs, measured: after.measured, ...(after.local ? { contentHashRule: CONTENT_HASH_RULE } : {}) },
  );
  return { graph: before, comparable: verdict.comparable, reasons: verdict.reasons };
}
