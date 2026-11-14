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
import { rootModules } from "./rootModules";
import { indexerWatches, onIndexedFacts, onIndexerWatching, trackLiveBatch } from "./indexLevels";
import { loadGraph, log, onKnowledgeChanged, openRoot, workspaceFolders, type GraphQuery } from "./knowledgeService";

/** Changes settle this long before the graph is re-read. */
const LIVE_DEBOUNCE_MS = 800;
/** Longest a switch to the background indexer waits for the view's own watcher batch in flight. */
const IN_FLIGHT_WAIT_MS = 5_000;
/**
 * A live refresh rebuilds the whole graph (a full `buildStoredGraph` over a large root), so two
 * rebuilds never run closer than this: burst watcher events (a review finish racing a save, the
 * indexer's first fact batches) collapse into one rebuild per window plus one trailing rebuild,
 * not one rebuild per event. Without this a busy root re-pushed a 20k-node graph several times a
 * second and the view never stopped flashing (then crashed under the churn).
 */
const REFRESH_MIN_INTERVAL_MS = 5_000;
/** A re-push whose graph signature AND changed-set both match the last push is dropped inside this window. */
const SAME_DIGEST_DROP_MS = 15_000;

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
 *
 * Rebuilds are throttled ({@link REFRESH_MIN_INTERVAL_MS}) and coalesced (one in flight, a
 * trailing refresh for what arrived during it), and a rebuilt graph is pushed only when it
 * actually differs from the last push — so a storm of watcher events cannot re-paint the view
 * on a loop.
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
  /** When the last rebuild STARTED: the throttle window opens from here. */
  let lastRunAt = 0;
  /** A rebuild is async: never start a second while one runs. */
  let rebuildRunning = false;
  /** A refresh that arrived while a rebuild ran runs once when it settles. */
  let trailingPending = false;
  /** Signature + changed-set of the last push, and when: identical re-pushes inside the window are dropped. */
  let lastPushKey = "";
  let lastPushAt = 0;

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

  const runRebuild = (): void => {
    timer = undefined;
    if (rebuildRunning) { trailingPending = true; return; }
    if (!live) return;
    rebuildRunning = true;
    lastRunAt = Date.now();
    void (async () => {
      try {
        const graph = await loadGraph(secrets, rootId, queryOf?.(rootId));
        if (!graph || !live) return;
        const changed = [...new Set([...(await pendingUnder(root)), ...watched])].sort();
        const key = pushKeyOf(graph, changed);
        // A provably-identical picture inside the window is not pushed again (indexer overlap and the
        // live overlay are not perfectly deterministic); a graph without an identity always goes out.
        if (key !== null && key === lastPushKey && Date.now() - lastPushAt < SAME_DIGEST_DROP_MS) {
          log("live refresh", `skipped same-picture push (${key.slice(0, 80)})`);
          return;
        }
        if (key !== null) { lastPushKey = key; lastPushAt = Date.now(); }
        onGraph(graph, changed);
      } catch (error: unknown) {
        log("live refresh", error);
      } finally {
        rebuildRunning = false;
        if (trailingPending && live) { trailingPending = false; schedule(); }
      }
    })();
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    // Throttled (never closer than REFRESH_MIN_INTERVAL_MS), debounced past that: bursts collapse.
    const wait = Math.max(LIVE_DEBOUNCE_MS, REFRESH_MIN_INTERVAL_MS - (Date.now() - lastRunAt));
    timer = setTimeout(runRebuild, wait);
  };

  const refresh = (): void => { schedule(); };

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
      const open = openRoot(secrets, root);
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
          for (const p of paths) watched.add(p);
          refresh();
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
   * facts rather than run a second watcher over the same files. When the indexer starts or stops (the auto-index setting,
   * a folder change) the view switches over.
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
      stopWatch = onIndexedFacts(rootId, ({ paths }) => {
        for (const p of paths) watched.add(p);
        refresh();
      });
    };
    // The own watcher's batch already running finishes first (its stop drops only batches not started yet), so the
    // indexer never takes over mid-write; a batch that never reports is waited for at most IN_FLIGHT_WAIT_MS.
    const running = inFlight?.done;
    if (!running) { subscribe(); return; }
    void Promise.race([running, new Promise<void>((resolve) => { setTimeout(resolve, IN_FLIGHT_WAIT_MS); })]).then(() => { inFlight?.end(); subscribe(); }); // a batch that never reported is closed here
  };
  useMode(indexerWatches(rootId));
  const stopMode = onIndexerWatching(rootId, (indexed) => { if (live) useMode(indexed); });
  const pending = watchPendingChanges(refresh);
  const stopReviewed = onKnowledgeChanged((changedRoot) => {
    if (changedRoot !== rootId) return;
    entityKeys?.invalidate(); // A review may have written entities: read them again at the next save.
    refresh();
  });

  return () => {
    live = false;
    if (timer) clearTimeout(timer);
    stopMode();
    stopWatch?.();
    pending.dispose();
    stopReviewed();
  };
}
