/**
 * The editor's ports for one root's background indexer (PRD 41 B6) — the adapter at the edge. Everything here is the
 * existing knowledge path, reused, never a second one:
 *
 *   plan          — the review's plan (`reviewRoot(...).backgroundPlan`: the root's source with the stat manifest in the
 *                   folder's SQLite store, git blob hints, Merkle; no judge started) — timed by `indexReconcile.planIndex`;
 *   extractEdited — `markFilesEdited` (agent-tools `fileEdits.ts`), the shared edited-file path: hash, early cutoff,
 *                   mark stale, re-extract by the new hash;
 *   mapPass       — `reviewRoot(...).mapPass`: the review's own ports at its map-only stage (`reviewPortsFor` `mapOnly`:
 *                   symbols, history, root files, the knowledge index, systems — no judge), `judgeFiles: 0`, the extraction
 *                   worker pool; it tells `onKnowledgeChanged` listeners when it lands. With `analyzers`, L3;
 *   wouldList     — the last plan's ignore files and skipped folders (`indexReconcile.listingFilter`);
 *   onFactsChanged — the L2 step (see {@link onFactsChanged}).
 */

import type * as vscode from "vscode";
import { createReviewRecorder, knownKeysCache, markFilesEditedDetailed, reviewPacks } from "@builderforce/agent-tools/knowledge";
import { recentCommits } from "@builderforce/agent-tools/node-git-history";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import { ignoreSourcesOf, type FactStoreVersion, type PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { symbolGrammarOptions } from "../workspaceSymbols";
import { anyRunActive } from "./activeRuns";
import { l3StateOf } from "./l3Persist";
import { sqliteCandidateRows, sqliteFactStore } from "@builderforce/agent-tools/node-knowledge-store";
import { FactIndex } from "./factIndex";
import { registerFactIndex } from "./factFindings";
import { FactGraphStore } from "./factGraphStore";
import { folderKnowledge } from "./folderKnowledge";
import { extractFactsJob, factsJobWidth } from "./review/extractPoolHost";
import { rootModules } from "./rootModules";
import { ALL_FACT_KINDS, liveWatcherIdle, publishIndexedFacts, type FactKind } from "./indexLevels";
import { LIVE_IDLE_WAIT_MS } from "./indexBudget";
import { listedPaths, listingFilter, planIndex } from "./indexReconcile";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import { isReviewingUnder } from "./knowledgeReplica";
import { reviewRecords } from "./knowledgeSyncStatus";
import type { KnowledgeRoot } from "./knowledgeRoots";
import { log, onKnowledgeChanged, openRoot, reviewRoot } from "./knowledgeService";
import type { IndexRootPorts } from "./rootIndexer";

/**
 * THE step after a root's facts changed (L2). The incremental FactRule evaluator (`factIndex.ts`, memory
 * `updateFactGraph`) has already run in the extract step that produced these paths; this tells the graph's readers (the
 * live view) which paths and which fact KINDS moved (a comment edit: `content` only), and they re-read the graph, whose
 * generic and code-pack findings come from this root's fact index (`factFindings.ts`).
 */
export async function onFactsChanged(rootId: string, changedPaths: readonly string[], changedKinds: readonly FactKind[] = ALL_FACT_KINDS): Promise<void> {
  publishIndexedFacts({ rootId, paths: changedPaths, kinds: changedKinds });
}

/** Per root, the fact store's version after this session's last sweep (`FactGraphStore.sweptAt`). */
const lastSweeps = new Map<string, FactStoreVersion>();

/** The recent commits whose files are queued ahead of the rest (B6 scheduling 4: `git log -n 200`). */
const RECENT_COMMITS = 200;

export interface HostIndexPorts extends IndexRootPorts {
  dispose(): void;
}

export function hostIndexPorts(secrets: vscode.SecretStorage, root: KnowledgeRoot): HostIndexPorts {
  const { rootId } = root;
  // The root is opened ONCE for the indexer's life (its source keeps its walk's nested-checkout knowledge; the stat
  // manifest and the store connection carry over), while the review handle — and with it the run ports' memoised steps:
  // symbols, history, layers — is made fresh at the start of every reconcile cycle, so a pass never runs on stale ones.
  const open = openRoot(secrets, root);
  // ONE recorder for the indexer's life too. Its counts never reach the sync status: records land only when a review
  // finishes (`run`), and the indexer's passes never call it — the Sync panel's numbers stay the person's last review's.
  const recorder = createReviewRecorder({ rootId, store: reviewRecords, folders: () => open.source.skippedFolders() });
  let review = reviewRoot(secrets, root, { open, recorder });
  const caps = buildLocalCapabilityProvider(root.folderPath);
  // The edited-file path's packs: the layers only, no warm symbol index (an edited file is read from its NEW content).
  let packs: ReturnType<typeof reviewPacks> | undefined;
  const editPacks = async (): Promise<ReturnType<typeof reviewPacks>> => {
    if (packs) return packs;
    const partitions = await readPartitions({ caps }).catch((error: unknown) => { log("index partitions", error); return undefined; });
    return (packs = reviewPacks(partitions ? { partitions } : {}));
  };
  // One held read of the root's entity keys; a finished review or pass (the only writers of entities) drops it.
  const knownKeys = knownKeysCache(open.store, rootId);
  const stopChanged = onKnowledgeChanged((changed) => { if (changed === rootId) knownKeys.invalidate(); });
  // The root's fact graph (PRD 41 §B1/§B5): raw FileFacts through THE extraction pool (a sliding window at its width),
  // resolved against the root's listing and aliases, the FactRule evaluator, real changed kinds. Registered for the view's
  // findings (`factFindings.ts`).
  // Persisted in the folder's own knowledge file (G03 `index.sqlite`, `sqliteFactStore`): restored once at start, the
  // delta saved after every apply. Every fact step waits for the restore.
  const indexLog = (what: string, error: unknown) => log(`index ${what}`, error);
  // The version after this session's last sweep of the root carries over an indexer restart (a folder removed and re-added).
  const store = new FactGraphStore(sqliteFactStore(folderKnowledge(root.folderPath).persistence, rootId), indexLog, lastSweeps.get(rootId));
  const facts = new FactIndex({
    facts: (path, hash, signal) => extractFactsJob({ rootId, rootPath: root.rootPath, path, hash, ...symbolGrammarOptions() }, signal),
    concurrency: factsJobWidth,
    store,
    candidates: sqliteCandidateRows(folderKnowledge(root.folderPath).persistence, rootId),
    log: indexLog,
  });
  const restored = facts.restore().catch((error: unknown) => { indexLog("fact store restore", error); return false; });
  const unregister = registerFactIndex(rootId, facts);
  // "Would the plan list this file?", by the rules the last plan read (rebuilt after each plan, on first use).
  let lastDetail: PlanDetail | undefined;
  let listing: Promise<(path: string) => boolean> | undefined;
  const listingOf = (detail: PlanDetail): Promise<(path: string) => boolean> => (listing ??= (async () => {
    const ignoreTexts: Array<{ text: string; base: string }> = [];
    for (const { path, base } of ignoreSourcesOf(listedPaths(detail))) {
      const doc = await open.source.read(path).catch(() => undefined);
      if (doc?.content.kind === "text") ignoreTexts.push({ text: doc.content.text, base });
    }
    return listingFilter({ ignoreTexts, skippedFolders: open.source.skippedFolders().map((f) => f.path) });
  })());

  return {
    rootId,
    async plan() {
      // A new cycle: fresh run ports, and the edited-file path re-reads the layers.
      review = reviewRoot(secrets, root, { open, recorder });
      packs = undefined;
      const plan = await planIndex(() => review.backgroundPlan());
      lastDetail = plan.detail;
      listing = undefined;
      return plan;
    },
    async extractEdited(paths) {
      await open.migrated;
      // The edit path hashed each file as it read it: the fact index takes that hash (no second read).
      const results = await markFilesEditedDetailed({
        rootId, rootPath: root.rootPath, fs: vscodeKnowledgeFs(), store: open.store, manifest: open.manifest, knownKeys, packs: await editPacks(),
      }, paths);
      const staled = results.filter((r) => r.staled);
      await restored;
      const moved = staled.length > 0 ? await facts.update(staled.map((r) => ({ path: r.path, hash: r.hash ?? "" }))) : undefined;
      return {
        changed: staled.map((r) => r.path),
        unreviewed: results.filter((r) => !r.reviewed).map((r) => r.path),
        ...(moved ? { changedKinds: moved.changedKinds } : {}),
      };
    },
    async mapPass(plan, { analyzers, signal }) {
      await review.mapPass({ plan: plan.detail, analyzers, signal });
      // The L1 pass extracted the plan's changed files (the indexer syncs the fact graph in the same pass); L3's news is the analysis.
      return { changed: analyzers ? [] : [...plan.changed] };
    },
    async syncFacts(plan, signal) {
      // The stored graph first (only what moved since is extracted), the root's aliases (a change re-resolves every file),
      // then the whole listing.
      await restored;
      const aliased = facts.setAliases((await rootModules(root)).aliases);
      const synced = await facts.sync(plan.detail.files.map((f) => ({ path: f.path, hash: f.hash })), signal);
      return {
        changedPaths: [...new Set([...aliased.changedPaths, ...synced.changedPaths])].sort(),
        changedKinds: ALL_FACT_KINDS.filter((k) => aliased.changedKinds.includes(k) || synced.changedKinds.includes(k)),
      };
    },
    near: (seeds) => facts.near(seeds, 2),
    sweepFacts: async () => { await restored; return facts.sweep(); },
    async wouldList(paths) {
      if (!lastDetail) return [...paths];
      const lists = await listingOf(lastDetail);
      return paths.filter(lists);
    },
    onFactsChanged: (changedPaths, changedKinds) => onFactsChanged(rootId, changedPaths, changedKinds),
    // The folder's own reviews AND its sub-folder roots' (`<rootId>:<rel>`): a folder pass would cover their files too.
    busy: () => isReviewingUnder(rootId),
    // An agent/chat run: the person is idle while it works, so the idle gate alone would start L3 mid-run. Read by the L3 gate only.
    agentBusy: anyRunActive,
    l3State: l3StateOf(root),
    liveIdle: () => liveWatcherIdle(rootId, LIVE_IDLE_WAIT_MS),
    recent: async () => new Set((await recentCommits(root.rootPath, RECENT_COMMITS)).flatMap((c) => c.paths)),
    dispose: () => {
      stopChanged();
      unregister();
      if (store.sweptAt) lastSweeps.set(rootId, store.sweptAt);
    },
  };
}
