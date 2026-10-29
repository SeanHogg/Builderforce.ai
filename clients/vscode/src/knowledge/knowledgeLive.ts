/**
 * The Knowledge view's LIVE input in the editor (PRD 38 §4.5: "Live: `pendingChanges` and
 * diffs (VS Code)"): while the view watches a root, the files a run (or the person) has
 * changed since — the working tree's pending changes under the root, plus every file the
 * folder's watcher saw — ride with the root's graph, which is re-read after a review
 * finishes. The view marks them (`applyLiveOverlay`).
 *
 * A reviewed file that changes also makes what was judged from it STALE (§5.2): the shared
 * `watchFileEdits` marks its facts and relations stale at the new content hash and
 * re-extracts it, before the graph is re-read — no model call, nothing deleted.
 */

import type * as vscode from "vscode";
import { knownKeysCache, reviewPacks, watchFileEdits, type KnownKeysCache } from "@builderforce/agent-tools/knowledge";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { detectPendingChanges, watchPendingChanges } from "../gitChanges";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { createDirectorySource } from "./vscodeDirectorySource";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import { rootById, type KnowledgeRoot } from "./knowledgeRoots";
import { loadGraph, log, onKnowledgeChanged, openRoot, workspaceFolders, type GraphQuery } from "./knowledgeService";

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

/**
 * `queryOf(rootId)` is how the view last loaded the root (the bridge's `load`): the refresh
 * re-reads the graph by the SAME query, so a view focused on search hits keeps its focus.
 */
export function subscribeLiveGraph(
  secrets: vscode.SecretStorage,
  rootId: string,
  onGraph: (graph: KnowledgeGraph, changed: string[]) => void,
  queryOf?: (rootId: string) => GraphQuery | undefined,
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
        const graph = await loadGraph(secrets, rootId, queryOf?.(rootId));
        if (!graph || !live) return;
        const changed = [...new Set([...(await pendingUnder(root)), ...watched])].sort();
        onGraph(graph, changed);
      })().catch((error: unknown) => log("live refresh", error));
    }, LIVE_DEBOUNCE_MS);
  };

  const source = createDirectorySource({ fs: vscodeKnowledgeFs(), rootPath: root.rootPath, rootId, title: root.title });
  let stopWatch: (() => void) | undefined;
  let entityKeys: KnownKeysCache | undefined;
  void (async () => {
    try {
      const open = openRoot(secrets, root);
      const partitions = await readPartitions({ caps: buildLocalCapabilityProvider(root.folderPath) }).catch((error: unknown) => { log("live partitions", error); return undefined; });
      if (!live) return;
      entityKeys = knownKeysCache(open.store, rootId);
      stopWatch = watchFileEdits({
        rootId, rootPath: root.rootPath, fs: vscodeKnowledgeFs(), source, store: open.store, manifest: open.manifest,
        knownKeys: entityKeys,
        // The folder's watcher (`knowledgeFs`) already settles a burst: no second wait here.
        debounceMs: 0,
        // No warm symbol index: an edited file is read from its NEW content.
        packs: reviewPacks(partitions ? { partitions } : {}),
        onEdited: (paths) => {
          for (const p of paths) watched.add(p);
          refresh();
        },
        onError: (error) => log("stale marking", error),
      });
    } catch (error) {
      // No stale marking without the root's ports — the overlay (pending changes, the refresh after a review) goes on.
      log("live watch", error);
    }
  })();
  const pending = watchPendingChanges(refresh);
  const stopReviewed = onKnowledgeChanged((changedRoot) => {
    if (changedRoot !== rootId) return;
    entityKeys?.invalidate(); // A review may have written entities: read them again at the next save.
    refresh();
  });

  return () => {
    live = false;
    if (timer) clearTimeout(timer);
    stopWatch?.();
    pending.dispose();
    stopReviewed();
  };
}
