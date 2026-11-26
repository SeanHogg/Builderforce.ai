/**
 * The Knowledge view's LIVE input in the editor (PRD 38 §4.5: "Live: `pendingChanges` and
 * diffs (VS Code)") for a RUNNING root (the view's Run, `visualizerSession.ts`): after Run the
 * view tracks deltas only.
 *
 *   - a change batch (the folder's watcher through `watchFileEdits`, or the background indexer's
 *     changed facts when it watches the root) becomes a bounded PATCH read from the changed files'
 *     extracted output (`livePatch.ts`) — never a graph rebuild per change;
 *   - the whole graph (importance, communities, findings) refreshes through ONE `loadGraph` at most
 *     every 30 s while something changed (`liveRefresh.ts`); a batch of more than
 *     {@link PATCH_MAX_FILES} files (a branch switch) asks for that refresh instead of a patch, and
 *     so does a review (or indexer pass) landing on the root;
 *   - the working tree's pending changes under the root plus every file the batches saw ride along
 *     as `changed`, which the view marks (`applyLiveOverlay`).
 *
 * A reviewed file that changes also makes what was judged from it STALE (§5.2): the shared
 * `watchFileEdits` marks its facts and relations stale at the new content hash and re-extracts it
 * — no model call, nothing deleted; the patch carries the stale refs.
 */

import type * as vscode from "vscode";
import { knownKeysCache, reviewPacks, watchFileEdits, type KnownKeysCache } from "@builderforce/agent-tools/knowledge";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { detectPendingChanges, watchPendingChanges } from "../git/gitChanges";
import { buildLocalCapabilityProvider } from "../tools/localCapabilities";
import { createDirectorySource } from "./vscodeDirectorySource";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import type { KnowledgeGraphPatch } from "./knowledgeProtocol";
import { rootById, type KnowledgeRoot } from "./knowledgeRoots";
import { rootModules } from "./rootModules";
import { indexerWatches, onIndexedFacts, onIndexerWatching, trackLiveBatch } from "./indexLevels";
import { loadGraph, log, onKnowledgeChanged, openRoot, workspaceFolders, type GraphQuery } from "./knowledgeService";
import { LivePatchBuilder, PATCH_MAX_FILES } from "./livePatch";
import { throttledRefresh } from "./liveRefresh";
import { GRAPH_BUILD_ABORTED } from "./graphWorker";

/** Longest a switch to the background indexer waits for the view's own watcher batch in flight. */
const IN_FLIGHT_WAIT_MS = 5_000;
/** A re-push whose graph signature AND changed-set both match the last push is dropped inside this window. */
const SAME_DIGEST_DROP_MS = 60_000;

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

/** What a running root's live stream delivers. */
export interface LiveGraphHandlers {
  /** A whole graph (the throttled refresh), with the changed-set. */
  onGraph(graph: KnowledgeGraph, changed: string[]): void;
  /** A change batch to apply to the graph on screen. */
  onPatch(patch: KnowledgeGraphPatch): void;
}

/**
 * `queryOf(rootId)` is how the view last loaded the root (the bridge's `load`): the whole-graph
 * refresh re-reads it by the SAME query, so a view focused on search hits keeps its focus. The
 * subscription starts right after the Run's own load, so the first refresh window opens from now.
 */
export function subscribeLiveGraph(
  secrets: vscode.SecretStorage,
  rootId: string,
  handlers: LiveGraphHandlers,
  queryOf?: (rootId: string) => GraphQuery | undefined,
): () => void {
  const root = rootById(rootId, workspaceFolders());
  if (!root) return () => undefined;
  const watched = new Set<string>();
  let pending: string[] = [];
  let live = true;
  /** Signature + changed-set of the last whole-graph push, and when: identical re-pushes inside the window are dropped. */
  let lastPushKey = "";
  let lastPushAt = 0;
  /** The changed-set last sent (with a patch or a graph): a pending-changes tick that moves nothing sends nothing. */
  let lastChanged = "";
  const changedSet = (): string[] => [...new Set([...pending, ...watched])].sort();

  /**
   * What identifies a pushed graph: the scope digest, the counts, and the live changed-set.
   * A graph without those (a malformed or partial build) returns null and is ALWAYS pushed —
   * the no-op guard only applies when the host can prove the picture is identical.
   */
  const pushKeyOf = (g: KnowledgeGraph, changed: readonly string[]): string | null => {
    const s = g?.scope;
    const st = g?.stats;
    if (!s || typeof s.digest !== "string" || !st) return null;
    return `${s.digest}:${st.nodes}:${st.edges}:${st.sources}:${st.stale}|${changed.join(",")}`;
  };

  const open = openRoot(secrets, root);
  const patcher = new LivePatchBuilder({ rootId, store: open.store, manifest: open.manifest });
  void patcher.rebase().catch((error: unknown) => log("live patch base", error));
  /** Aborted on unlive / dispose: a whole-graph refresh still building drops its result. */
  const refreshAbort = new AbortController();

  const full = throttledRefresh(async () => {
    try {
      // The hashes this build starts from: patches diff against them once it is on screen.
      const base = await patcher.baseNow().catch((error: unknown) => { log("live patch base", error); return undefined; });
      const graph = await loadGraph(secrets, rootId, queryOf?.(rootId), undefined, undefined, { signal: refreshAbort.signal });
      if (!graph || !live) return;
      if (base) patcher.useBase(base);
      const changed = changedSet();
      const key = pushKeyOf(graph, changed);
      // A provably-identical picture inside the window is not pushed again; a graph without an identity always goes out.
      if (key !== null && key === lastPushKey && Date.now() - lastPushAt < SAME_DIGEST_DROP_MS) {
        log("live refresh", `skipped same-picture push (${key.slice(0, 80)})`);
        return;
      }
      if (key !== null) { lastPushKey = key; lastPushAt = Date.now(); }
      lastChanged = changed.join("\n");
      handlers.onGraph(graph, changed);
    } catch (error: unknown) {
      // An unlive / dispose aborted the build: nothing to report.
      if ((error as { code?: unknown } | null)?.code === GRAPH_BUILD_ABORTED) return;
      log("live refresh", error);
    }
  });

  /** Batches are patched one after another: each diffs against the hashes the previous one moved forward. */
  let patchChain: Promise<void> = Promise.resolve();
  const sendPatch = (paths: readonly string[]): void => {
    patchChain = patchChain.then(async () => {
      if (!live) return;
      try {
        const changed = changedSet();
        const patch = await patcher.build(paths, changed);
        if (!live) return;
        const changedKey = changed.join("\n");
        if (patch.files.length === 0 && changedKey === lastChanged) return; // nothing on screen moves
        lastChanged = changedKey;
        handlers.onPatch(patch);
        // The whole-graph scores follow at most once per window.
        if (patch.files.length > 0) full.request();
      } catch (error: unknown) {
        log("live patch", error);
        full.request(); // the patch could not be read: the throttled full refresh catches the picture up
      }
    });
  };

  /** One change batch: a patch, or (a branch switch) the throttled full refresh. */
  const onBatch = (paths: readonly string[]): void => {
    for (const p of paths) watched.add(p);
    if (paths.length > PATCH_MAX_FILES) { full.request(); return; }
    sendPatch(paths);
  };

  let stopWatch: (() => void) | undefined;
  let entityKeys: KnownKeysCache | undefined;
  /** Bumped on every mode switch: a watcher still starting for an older mode never installs itself. */
  let mode = 0;
  /** The own watcher's batch in flight (from its watcher event until `onEdited`): a switch to the indexer waits for it. */
  let inFlight: { done: Promise<void>; end: () => void } | undefined;
  const batchStarted = (): void => {
    if (inFlight) return;
    let end!: () => void;
    const done = new Promise<void>((resolve) => { end = resolve; });
    inFlight = { done, end: () => { inFlight = undefined; end(); } };
    // The indexer's first write on this root waits for it too (the hand-over in the other direction).
    trackLiveBatch(rootId, done);
  };
  const startOwnWatcher = (): void => { const mine = mode; void (async () => {
    try {
      const listed = createDirectorySource({ fs: vscodeKnowledgeFs(), rootPath: root.rootPath, rootId, title: root.title });
      const source = listed.watch
        ? { ...listed, watch: (cb: (paths: string[]) => void) => listed.watch!((paths) => { batchStarted(); cb(paths); }) }
        : listed;
      const partitions = await readPartitions({ caps: buildLocalCapabilityProvider(root.folderPath) }).catch((error: unknown) => { log("live partitions", error); return undefined; });
      // The root's path aliases, so an edited file's re-extract stores the same resolved edges a review does.
      const modules = await rootModules(root);
      if (!live || mine !== mode) return;
      entityKeys = knownKeysCache(open.store, rootId);
      stopWatch = watchFileEdits({
        rootId, rootPath: root.rootPath, fs: vscodeKnowledgeFs(), source, store: open.store, manifest: open.manifest,
        knownKeys: entityKeys,
        // The folder's watcher (`knowledgeFs`) already settles a burst: no second wait here.
        debounceMs: 0,
        // No warm symbol index: an edited file is read from its NEW content.
        packs: reviewPacks({ ...(partitions ? { partitions } : {}), modules }),
        onEdited: (paths) => {
          inFlight?.end();
          onBatch(paths);
        },
        onError: (error) => log("stale marking", error),
      });
    } catch (error) {
      // No stale marking without the root's ports — the overlay (pending changes, the refresh after a review) goes on.
      log("live watch", error);
    }
  })(); };
  /**
   * The background indexer watching this root (PRD 41 B6) already re-extracts what changes: the view hears its changed
   * facts rather than run a second watcher over the same files. When the indexer starts or stops (a Run, the last
   * Visualizer closing, the auto-index setting, a folder change) the view switches over.
   */
  const useMode = (indexed: boolean): void => {
    mode += 1;
    const mine = mode;
    stopWatch?.();
    stopWatch = undefined;
    entityKeys = undefined;
    if (!indexed) { startOwnWatcher(); return; }
    const subscribe = (): void => {
      if (!live || mine !== mode) return;
      stopWatch = onIndexedFacts(rootId, ({ paths }) => onBatch(paths));
    };
    // The own watcher's batch already running finishes first (its stop drops only batches not started yet), so the
    // indexer never takes over mid-write; a batch that never reports is waited for at most IN_FLIGHT_WAIT_MS.
    const running = inFlight?.done;
    if (!running) { subscribe(); return; }
    void Promise.race([running, new Promise<void>((resolve) => { setTimeout(resolve, IN_FLIGHT_WAIT_MS); })]).then(() => { inFlight?.end(); subscribe(); }); // a batch that never reported is closed here
  };
  useMode(indexerWatches(rootId));
  const stopMode = onIndexerWatching(rootId, (indexed) => { if (live) useMode(indexed); });
  // The working tree's pending changes only move the changed-set: a patch with no files, sent only when the set moved.
  const readPending = (): void => {
    void pendingUnder(root).then((paths) => {
      if (!live) return;
      pending = paths;
      sendPatch([]);
    });
  };
  readPending();
  const pendingWatch = watchPendingChanges(readPending);
  const stopReviewed = onKnowledgeChanged((changedRoot) => {
    if (changedRoot !== rootId) return;
    entityKeys?.invalidate(); // A review may have written entities: read them again at the next save.
    full.request();
  });

  return () => {
    live = false;
    refreshAbort.abort();
    full.dispose();
    stopMode();
    stopWatch?.();
    pendingWatch.dispose();
    stopReviewed();
  };
}
