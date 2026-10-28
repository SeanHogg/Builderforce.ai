/**
 * The Knowledge view's LIVE input in the editor (PRD 38 §4.5: "Live: `pendingChanges` and
 * diffs (VS Code)"): while the view watches a root, the files a run (or the person) has
 * changed since — the working tree's pending changes under the root, plus every file the
 * folder's watcher saw — ride with the root's graph, which is re-read after a review
 * finishes. The view marks them (`applyLiveOverlay`); nothing is written to memory.
 */

import type * as vscode from "vscode";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { detectPendingChanges, watchPendingChanges } from "../gitChanges";
import { createDirectorySource } from "./vscodeDirectorySource";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import { rootById, type KnowledgeRoot } from "./knowledgeRoots";
import { loadGraph, log, onKnowledgeChanged, workspaceFolders } from "./knowledgeService";

/** Changes settle this long before the graph is re-read. */
const LIVE_DEBOUNCE_MS = 800;

const norm = (p: string): string => p.replace(/\\/g, "/");

/** The pending changes under `root`, root-relative. */
async function pendingUnder(root: KnowledgeRoot): Promise<string[]> {
  const set = await detectPendingChanges().catch(() => undefined);
  const prefix = `${norm(root.rootPath)}/`.toLowerCase();
  return (set?.repos ?? [])
    .flatMap((r) => r.changes)
    .map((c) => norm(c.path))
    .filter((p) => p.toLowerCase().startsWith(prefix))
    .map((p) => p.slice(prefix.length));
}

export function subscribeLiveGraph(
  secrets: vscode.SecretStorage,
  rootId: string,
  onGraph: (graph: KnowledgeGraph, changed: string[]) => void,
): () => void {
  const root = rootById(rootId, workspaceFolders());
  if (!root) return () => undefined;
  const watched = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live = true;

  const refresh = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void (async () => {
        const graph = await loadGraph(secrets, rootId);
        if (!graph || !live) return;
        const changed = [...new Set([...(await pendingUnder(root)), ...watched])].sort();
        onGraph(graph, changed);
      })().catch((error: unknown) => log("live refresh", error));
    }, LIVE_DEBOUNCE_MS);
  };

  const source = createDirectorySource({ fs: vscodeKnowledgeFs(), rootPath: root.rootPath, rootId, title: root.title });
  const stopWatch = source.watch?.((paths) => {
    for (const p of paths) watched.add(p);
    refresh();
  });
  const pending = watchPendingChanges(refresh);
  const stopReviewed = onKnowledgeChanged((changedRoot) => { if (changedRoot === rootId) refresh(); });

  return () => {
    live = false;
    if (timer) clearTimeout(timer);
    stopWatch?.();
    pending.dispose();
    stopReviewed();
  };
}
