/**
 * `knowledge.ask` in the editor's PreFetch registry (PRD 38 §4.9) — the shared row and
 * executor (`@builderforce/agent-tools/knowledge-index`) over the workspace folder's
 * knowledge index (`knowledge/index/hostKnowledgeIndex.ts`). Composed into the registry and
 * the executors by `executors.ts`; the gate decides answer versus prefetch from the
 * executor's own `confidence` against the action's learned threshold.
 *
 * No `vscode` import.
 */

import { KNOWLEDGE_ASK, KNOWLEDGE_ASK_ROW, knowledgeAskExecutor } from "@builderforce/agent-tools/knowledge-index";
import type { PrefetchAction, PrefetchExecutors } from "@builderforce/prefetch";
import { workspaceKnowledgeIndex } from "../knowledge/index/hostKnowledgeIndex";

/** The row, ahead of the shared ones in the editor's registry. */
export const KNOWLEDGE_ASK_ROWS: readonly PrefetchAction[] = [KNOWLEDGE_ASK_ROW];

/** Its executor over the open folder's index; `ownWords` stands in for a request that inlines references. */
export function knowledgeAskExecutors(root: () => string, ownWords?: string): PrefetchExecutors {
  const ask = knowledgeAskExecutor({
    index: async () => {
      const r = root();
      return r ? workspaceKnowledgeIndex(r) : undefined;
    },
  });
  return { [KNOWLEDGE_ASK]: { run: (request, signal) => ask.run(ownWords ?? request, signal) } };
}
