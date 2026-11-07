/**
 * THE EDITOR'S KNOWLEDGE HOST (PRD 38 §4.7, VS Code row) — ports only. It decides where
 * files come from and where knowledge is kept, never what the graph contains:
 *
 *   source     — the reviewed folder over `vscode.workspace.fs` (`vscodeDirectorySource.ts`);
 *   store      — ALWAYS the local snapshot (`knowledgeStores.ts`), wrapped by
 *                `replicatedKnowledgeStore`: linked to a project (the selected project), every
 *                write is also queued for it and the replica pump sends it (`knowledgeReplica.ts`);
 *   review     — the shared runner (`@builderforce/agent-tools/knowledge`) in the extension
 *                host, with the editor's warm symbol index, the code pack's analyzers through
 *                the local shell (their snapshot queued for the project when linked), the
 *                judgement port (`knowledgeJudgement.ts`) and the knowledge index's `similar`;
 *   graph      — ALWAYS built here from the local store (PRD 41 A7), linked or not; the
 *                server's graph is read only for the Sync drawer's server column.
 *
 * Used by the panel's bridge (`knowledgeBridge.ts`), the PreFetch rows (`knowledgeRows.ts`)
 * and the commands (`knowledgeCommands.ts`).
 */

import * as vscode from "vscode";
import {
  buildStoredGraph, claimSimilarity, createReviewRecorder, indexedSymbolLookup, indexedSymbolSource, migratingRootFiles, planKnowledgeReviewDetail, repoGraphEdgeCount, reviewIndexPort, reviewPacks,
  rootManifest, rootStore, runKnowledgeReview, workspaceCodeAnalyzers,
  type FsDirectorySource, type KnowledgeReviewOptions, type KnowledgeReviewPorts, type RepoGraphPort, type ReviewRecorder, type SymbolLookup,
} from "@builderforce/agent-tools/knowledge";
import { gitHistoryPort } from "@builderforce/agent-tools/node-git-history";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import { createKnowledgeClient, type AnalysisSnapshotPayload, type KnowledgeClient } from "@builderforce/knowledge-client";
import type { KnowledgeGraph, KnowledgeStore, PlanDetail, ReviewReport } from "@seanhogg/builderforce-memory/knowledge";
import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { NOT_SIGNED_IN } from "@seanhogg/builderforce-brain-embedded";
import { repoMapPort } from "@builderforce/repo-map";
import { fetchAuthed, type AuthedInit } from "../bfApi";
import { getSelectedProject } from "../projectState";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { workspaceSymbolIndex } from "../workspaceSymbols";
import { logLine } from "../errorReporter";
import { getHostKnowledgeIndex } from "./index/hostKnowledgeIndex";
import { vscodeKnowledgeFs, workspaceKnowledgeFiles } from "./knowledgeFs";
import { createDirectorySource, type HashCache } from "./vscodeDirectorySource";
import { fileManifest, localKnowledgeStore, manifestFileName, type KnowledgeFiles } from "./knowledgeStores";
import { configureReplicaLog, duringReview, replicaQueueFor, replicatedStoreOf, type PumpSource } from "./knowledgeReplica";
import { legacyRootIdOf, rememberRoot, rootById, type KnowledgeRoot, type RootsMemento, type WorkspaceFolderRef } from "./knowledgeRoots";
import { editorJudgement, type TrackedJudgement } from "./knowledgeJudgement";
import { reviewRecords, useRecordMemento } from "./knowledgeSyncStatus";
import { reviewParallelism } from "./review/extractPoolHost";

/** Hashes remembered across reviews, so a re-review re-hashes only what changed on disk. */
const hashCache: HashCache = new Map();

/** Where the reviewed roots are listed (`workspaceState`), set at activation. */
let reviewedRootsMemento: RootsMemento | undefined;
export function configureKnowledgeHost(memento: RootsMemento): void {
  reviewedRootsMemento = memento;
  useRecordMemento(memento);
  configureReplicaLog(log);
}

export const log = (what: string, error: unknown): void =>
  logLine(`[knowledge] ${what}: ${error instanceof Error ? error.message : String(error)}`);

/** The open workspace folders. */
export function workspaceFolders(): WorkspaceFolderRef[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({ path: f.uri.fsPath }));
}

/** The knowledge client for the linked project; undefined when the workspace is not linked. */
export function linkedKnowledgeClient(secrets: vscode.SecretStorage): KnowledgeClient | undefined {
  const project = getSelectedProject();
  if (!project) return undefined;
  return createKnowledgeClient({
    projectId: project.id,
    fetch: async (path, init) => {
      const res = await fetchAuthed(secrets, path, init as AuthedInit | undefined);
      if (!res) throw new Error(NOT_SIGNED_IN);
      return res;
    },
  });
}

/** One root, opened: where its files are, where its knowledge goes, and its manifest. */
export interface OpenRoot {
  root: KnowledgeRoot;
  source: FsDirectorySource;
  /** The local store wrapped for replication: every read and write is local; linked, writes are also queued. */
  store: KnowledgeStore;
  /** The root's ONE local store (the pump reads bodies from it). */
  local: KnowledgeStore;
  client?: KnowledgeClient;
  /** Present when linked: what the replica pump needs. */
  pump?: PumpSource;
  manifest: IngestManifest;
  files: KnowledgeFiles;
}

/**
 * A root's local knowledge files (`.builderforce/knowledge/` of its workspace folder). A
 * root reviewed under its old, name-based id keeps its local graph: migrated on first read.
 */
export function rootKnowledgeFiles(root: KnowledgeRoot): KnowledgeFiles {
  return migratingRootFiles(workspaceKnowledgeFiles(root.folderPath), root.rootId, legacyRootIdOf(root));
}

/**
 * A root, opened. Its manifest and its LOCAL store are the root's ONE record in this process
 * (`rootStore` / `rootManifest`): the review, the live watcher and the graph reads all go through
 * them, so a watcher can never write back a snapshot older than a review's. The returned `store`
 * wraps that local store for replication; `readThrough` (the "Use the server's copy" seed) lets the
 * review seed its extracted cache from the project before it extracts.
 */
export function openRoot(secrets: vscode.SecretStorage, root: KnowledgeRoot, opts: { readThrough?: boolean } = {}): OpenRoot {
  const files = rootKnowledgeFiles(root);
  const client = linkedKnowledgeClient(secrets);
  const { rootId } = root;
  const local = rootStore(rootId, () => localKnowledgeStore(files, rootId), "local");
  const manifest = rootManifest(rootId, () => fileManifest(files, manifestFileName(rootId)), root.folderPath);
  const projectId = getSelectedProject()?.id;
  const pump: PumpSource | undefined = client && projectId !== undefined ? { rootId, files, local, client, projectId } : undefined;
  return {
    root,
    source: createDirectorySource({ fs: vscodeKnowledgeFs(), rootPath: root.rootPath, rootId, title: root.title, hashCache }),
    // A kicked pump resolves its source when it STARTS, never holding the client of a project the workspace left.
    store: replicatedStoreOf(rootId, files, local, pump, !!opts.readThrough, () => openRoot(secrets, root).pump),
    local,
    ...(client ? { client } : {}),
    ...(pump ? { pump } : {}),
    manifest,
    files,
  };
}

/** The repo map, reporting the import-edge count of each graph it builds to the review's record (the sync panel's local edges). */
function measuringRepoMap(recorder: ReviewRecorder): RepoGraphPort {
  return {
    accepts: (path, size) => repoMapPort.accepts(path, size),
    create() {
      const graph = repoMapPort.create();
      return {
        addFile: (path, content) => graph.addFile(path, content),
        build() {
          const built = graph.build();
          recorder.edges(repoGraphEdgeCount(built));
          return built;
        },
      };
    },
  };
}

/** The review's ports for an opened root: symbols, analyzers, layers, judgement and the index. */
async function reviewPorts(secrets: vscode.SecretStorage, open: OpenRoot, recorder: ReviewRecorder): Promise<KnowledgeReviewPorts & { symbolLookup: SymbolLookup }> {
  const { root, client } = open;
  const caps = buildLocalCapabilityProvider(root.folderPath);
  const partitions = await readPartitions({ caps });
  const symbols = await workspaceSymbolIndex(root.folderPath).filesUnder(root.rel || undefined).catch(() => []);
  const judgement = await editorJudgement(secrets, client);
  const history = await gitHistoryPort(root.rootPath, { onWarn: (message) => log("history", message) });
  const index = await getHostKnowledgeIndex(root.rootId).catch((error: unknown) => { log("index", error); return undefined; });
  return {
    source: open.source,
    store: open.store,
    manifest: open.manifest,
    partitions,
    symbolsOf: indexedSymbolSource(symbols, root.rel),
    // The same index hits, as plain data for the extraction pool's jobs (one symbol rule on both paths).
    symbolLookup: indexedSymbolLookup(symbols, root.rel),
    analyzers: workspaceCodeAnalyzers({
      caps,
      partitions,
      repoGraph: measuringRepoMap(recorder),
      ...(root.rel ? { path: root.rel } : {}),
      // The analysis is always kept locally (the review stores its output); linked, its snapshot is queued for the project.
      ...(open.pump ? {
        upload: async (sha: string, snapshot: unknown) => {
          const queue = replicaQueueFor(root.rootId, open.files);
          await queue.adopt(open.pump!.projectId);
          await queue.enqueue({ op: "putAnalysis", sha, snapshot: snapshot as AnalysisSnapshotPayload });
        },
      } : {}),
      onUploadError: (error) => log("analysis upload", error),
      onWarn: (message) => log("analysis", message),
    }),
    ...(history ? { history } : {}),
    rootFiles: { fs: vscodeKnowledgeFs(), rootPath: root.rootPath },
    onSignalsSkipped: (skipped) => recorder.signals(skipped),
    ...(judgement ? { judgement } : {}),
    ...(index ? { similar: claimSimilarity(index, open.store, root.rootId) } : {}),
    // After the review the root's graph feeds the knowledge index (the shared runner does it and reports the phase).
    index: reviewIndexPort(() => getHostKnowledgeIndex(root.rootId)),
    // No `platformGraph`: the knowledge index is fed from the LOCAL graph too, so nothing the editor
    // shows or searches depends on the server's version (PRD 41 A7).
    onIndexError: (error) => log("index upsert", error),
    onSystemsError: (error) => log("systems", error),
  };
}

/** A review of one root: plan first (no writes), then the review on that plan once confirmed (no re-walk). */
export interface RootReview {
  open: OpenRoot;
  plan(force?: boolean): Promise<PlanDetail>;
  run(opts: KnowledgeReviewOptions): Promise<ReviewReport>;
  /** The model(s) that actually judged during this review's runs, e.g. "local/ollama/qwen3"; undefined when no judgement ran or the judge names no model. */
  judgeModel(): Promise<string | undefined>;
}

/** `builderforce.knowledge.judgeBudgetFiles` (PRD 41 A10): files judged per run after the map is complete; default 500, never negative. */
const judgeBudgetFiles = (): number => {
  const n = Math.floor(Number(vscode.workspace.getConfiguration("builderforce").get<number>("knowledge.judgeBudgetFiles", 500)));
  return Number.isFinite(n) && n >= 0 ? n : 500;
};

/** Listeners told when a root's knowledge changed (a review finished): the live graph re-reads. */
const changedListeners = new Set<(rootId: string) => void>();
export function onKnowledgeChanged(cb: (rootId: string) => void): () => void {
  changedListeners.add(cb);
  return () => changedListeners.delete(cb);
}

/**
 * `seed` is "Use the server's copy": a local review with a server read-through — the extractor asks
 * the project's bulk extracted route for the files' content hashes first, so unchanged files cost no
 * model call (offline, the same review runs without it).
 */
export function reviewRoot(secrets: vscode.SecretStorage, root: KnowledgeRoot, opts: { seed?: boolean } = {}): RootReview {
  const open = openRoot(secrets, root, { readThrough: !!opts.seed });
  // What this review skips (plan, folders, coverage, uploads during the run) is recorded per root for the sync status.
  const recorder = createReviewRecorder({ rootId: root.rootId, store: reviewRecords, ...(open.client ? { client: open.client } : {}), folders: () => open.source.skippedFolders() });
  let ports: ReturnType<typeof reviewPorts> | undefined;
  const portsOnce = () => (ports ??= reviewPorts(secrets, open, recorder));
  return {
    open,
    async plan(force) {
      const detail = await planKnowledgeReviewDetail(await portsOnce(), { force: !!force });
      recorder.planned(detail.plan);
      return detail;
    },
    async run(opts) {
      const p = await portsOnce();
      if (reviewedRootsMemento) await rememberRoot(reviewedRootsMemento, root.rootId);
      // The shared runner feeds the knowledge index (reported as the `index` phase).
      recorder.begin();
      return duringReview(root.rootId, open.files, open.pump, async () => {
        // Extraction runs in the worker pool and judging N wide (PRD 41 A8); the caller's options win.
        const report = await runKnowledgeReview(p, { ...reviewParallelism(p.symbolLookup), judgeFiles: judgeBudgetFiles(), ...opts });
        recorder.finish();
        for (const cb of changedListeners) cb(root.rootId);
        return report;
      });
    },
    async judgeModel() {
      const judgement = (await portsOnce()).judgement as Partial<TrackedJudgement> | undefined;
      return judgement?.modelsUsed?.().join(", ") || undefined;
    },
  };
}

/** How the view reads a root's graph: the refs to load around, and the node cap. */
export interface GraphQuery { focus?: string[]; maxNodes?: number }

/**
 * A root's graph, ALWAYS built here from the local store (PRD 41 A7) — linked or not, online or
 * not: the cut, the outline and every badge are computed from the local projection, so the map
 * never depends on the server. Null when this machine holds no review of the root.
 */
export async function loadGraph(
  secrets: vscode.SecretStorage,
  rootId: string,
  q: GraphQuery = {},
): Promise<KnowledgeGraph | null> {
  const root = rootById(rootId, workspaceFolders());
  if (!root) return null;
  const open = openRoot(secrets, root);
  // Read in parallel: the partitions and the index are independent inputs to the build.
  const [partitions, index] = await Promise.all([
    readPartitions({ caps: buildLocalCapabilityProvider(root.folderPath) }),
    getHostKnowledgeIndex(rootId).catch(() => undefined),
  ]);
  return buildStoredGraph({
    rootId, store: open.store, manifest: open.manifest, packs: reviewPacks({ partitions }),
    ...(index ? { nearDuplicates: index.nearDuplicates() } : {}),
    ...(q.focus ? { focus: q.focus } : {}),
    ...(q.maxNodes ? { maxNodes: q.maxNodes } : {}),
  });
}
