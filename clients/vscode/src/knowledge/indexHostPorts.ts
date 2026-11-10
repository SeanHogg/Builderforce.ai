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
import { createReviewRecorder, knownKeysCache, markFilesEdited, reviewPacks } from "@builderforce/agent-tools/knowledge";
import { recentCommits } from "@builderforce/agent-tools/node-git-history";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import { ignoreSourcesOf, type PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { buildLocalCapabilityProvider } from "../localCapabilities";
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
 * THE step after a root's facts changed (L2) — the seam the incremental FactRule evaluator of WS4 plugs into.
 *
 * Today the findings are derived when the graph is built (memory `buildGraph` → `computeFindings`), so this step is the
 * existing findings path: it tells the graph's readers (the live view) which paths changed, and they re-read the graph,
 * which recomputes the findings. `changedKinds` is every kind until extraction splits facts into kinds (WS4).
 */
export async function onFactsChanged(rootId: string, changedPaths: readonly string[], changedKinds: readonly FactKind[] = ALL_FACT_KINDS): Promise<void> {
  publishIndexedFacts({ rootId, paths: changedPaths, kinds: changedKinds });
}

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
      const results = await markFilesEdited({
        rootId, rootPath: root.rootPath, fs: vscodeKnowledgeFs(), store: open.store, manifest: open.manifest, knownKeys, packs: await editPacks(),
      }, paths);
      return {
        changed: results.filter((r) => r.staled).map((r) => r.path),
        unreviewed: results.filter((r) => !r.reviewed).map((r) => r.path),
      };
    },
    async mapPass(plan, { analyzers, signal }) {
      await review.mapPass({ plan: plan.detail, analyzers, signal });
      // The L1 pass extracted the plan's changed files; the L3 pass's news is the root's analysis, not a file.
      return { changed: analyzers ? [] : [...plan.changed] };
    },
    async wouldList(paths) {
      if (!lastDetail) return [...paths];
      const lists = await listingOf(lastDetail);
      return paths.filter(lists);
    },
    onFactsChanged: (changedPaths, changedKinds) => onFactsChanged(rootId, changedPaths, changedKinds),
    // The folder's own reviews AND its sub-folder roots' (`<rootId>:<rel>`): a folder pass would cover their files too.
    busy: () => isReviewingUnder(rootId),
    liveIdle: () => liveWatcherIdle(rootId, LIVE_IDLE_WAIT_MS),
    recent: async () => new Set((await recentCommits(root.rootPath, RECENT_COMMITS)).flatMap((c) => c.paths)),
    dispose: () => stopChanged(),
  };
}
