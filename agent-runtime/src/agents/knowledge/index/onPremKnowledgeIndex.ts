/**
 * On-prem's knowledge index per root (DONE.md, deterministic knowledge index archive,
 * "Where it runs") — the same seam as the editor's (`getHostKnowledgeIndex(rootId)`), over
 * this runtime's own ports: the disk (atomic writes under
 * `<workspace>/.builderforce/knowledge/`), the SSM memory service's embed while it is warm
 * (`onPremEmbedder.ts`), and the on-prem definition index (`onPremSymbolIndex`) that seeds
 * the workspace repository's code cards on first use. Every rule is the shared registry's
 * (`@builderforce/agent-tools/knowledge-index`).
 *
 * A workspace becomes known when a run's PreFetch port asks for its index
 * (`onPremWorkspaceKnowledgeIndex`); a reviewed root under it resolves to the same folder.
 */

import { resolve } from "node:path";
import {
  KNOWLEDGE_IDLE_MS,
  createKnowledgeIndexRegistry,
  debouncedIdle,
  type HostKnowledgeIndex,
  type HostKnowledgeIndexCore,
  type KnowledgeIndexRegistry,
} from "@builderforce/agent-tools/knowledge-index.js";
import { nodeIndexFiles } from "@builderforce/agent-tools/node-index-layout";
import { logDebug } from "../../../logger.js";
import { onPremSymbolIndex } from "../../on-prem-symbol-index.js";
import { onPremEmbedder } from "./onPremEmbedder.js";
import { onPremRootId } from "./onPremRootId.js";

export type { HostKnowledgeIndex, HostKnowledgeIndexCore };

const workspaces = new Set<string>();
const registry: KnowledgeIndexRegistry = createKnowledgeIndexRegistry({
  workspaceRoots: () => [...workspaces],
  rootIdOf: (root) => onPremRootId(root),
  symbolFiles: (root) => onPremSymbolIndex(root).filesUnder(),
  files: nodeIndexFiles,
  embedder: () => onPremEmbedder(),
  idle: debouncedIdle(KNOWLEDGE_IDLE_MS, (e) => logDebug(`[knowledge-index] idle pass failed: ${String(e)}`)),
  onError: (e) => logDebug(`[knowledge-index] ${String(e)}`),
});

/**
 * The workspace's own index: seeded from the code pack on first use; asked again (a new
 * run — this runtime has no file events), its code cards are re-seeded, debounced, so
 * the run after an edit sees it. Unchanged cards cost nothing.
 */
export function onPremWorkspaceKnowledgeIndex(workspaceRoot: string): HostKnowledgeIndexCore {
  const root = resolve(workspaceRoot);
  workspaces.add(root);
  const index = registry.forWorkspace(root);
  registry.refresh(root);
  return index;
}

/** The index of `rootId` — the same seam the editor exposes. */
export function getHostKnowledgeIndex(rootId: string): Promise<HostKnowledgeIndex> {
  return Promise.resolve(registry.get(rootId));
}
