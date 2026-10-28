/**
 * On-prem's knowledge index per root (docs/design/deterministic-knowledge-index.md,
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

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { folderIdOf, repoIdOfRemote, rootIdFor } from "@builderforce/agent-tools/knowledge/index.js";
import { gitOriginUrlSync } from "@builderforce/agent-tools/node-git-remote.js";
import {
  KNOWLEDGE_IDLE_MS,
  createKnowledgeIndexRegistry,
  debouncedIdle,
  type HostKnowledgeIndex,
  type HostKnowledgeIndexCore,
  type KnowledgeIndexFiles,
  type KnowledgeIndexRegistry,
} from "@builderforce/agent-tools/knowledge-index.js";
import { logDebug } from "../../../logger.js";
import { onPremSymbolIndex } from "../../on-prem-symbol-index.js";
import { onPremEmbedder } from "./onPremEmbedder.js";

export type { HostKnowledgeIndex, HostKnowledgeIndexCore };

/** The disk, as the index's files. */
export const nodeIndexFiles: KnowledgeIndexFiles = {
  async read(path) {
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      return undefined;
    }
  },
  write: (path, bytes) => writeFile(path, bytes),
  rename: (from, to) => rename(from, to),
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  remove: (path) => rm(path, { force: true }),
};

/** On-prem's host segment of a root id. */
export const ONPREM_HOST = "onprem";

/**
 * The root id of a workspace — or of `rel`, a folder inside it — by THE root-id rule
 * (`rootIdFor`, PRD 38 §4.2): `onprem:<repo>` from the checkout's git remote, else
 * `onprem:<hash of the container path>`; `…:<rel>` for a folder inside. What the PreFetch
 * port's Open-in-graph refs name.
 */
export function onPremRootId(workspaceRoot: string, rel = ""): string {
  const abs = resolve(workspaceRoot);
  return rootIdFor({ host: ONPREM_HOST, repoId: repoIdOfRemote(gitOriginUrlSync(abs)), folderId: folderIdOf(abs), path: rel });
}

/** The pre-`rootIdFor` id (`<folder name>`, `/<rel>` inside it) its local manifest was named by. */
export function onPremLegacyRootId(workspaceRoot: string, rel = ""): string {
  const base = basename(resolve(workspaceRoot)) || "workspace";
  return rel ? `${base}/${rel}` : base;
}

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
