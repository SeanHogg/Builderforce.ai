/**
 * THE EDITOR'S KNOWLEDGE HOST (PRD 38 §4.7, VS Code row) — ports only. It decides where
 * files come from and where knowledge is kept, never what the graph contains:
 *
 *   source     — the reviewed folder over `vscode.workspace.fs` (`vscodeDirectorySource.ts`);
 *   store      — the platform when the workspace is linked to a project (the selected
 *                project), else the local snapshot (`knowledgeStores.ts`);
 *   review     — the shared runner (`@builderforce/agent-tools/knowledge`) in the extension
 *                host, with the editor's warm symbol index, the code pack's analyzers through
 *                the local shell (the snapshot uploaded when linked), the judgement port
 *                (`knowledgeJudgement.ts`) and the knowledge index's `similar`;
 *   graph      — linked: the platform's server-built graph; unlinked: built here from the
 *                local store.
 *
 * Used by the panel's bridge (`knowledgeBridge.ts`), the PreFetch rows (`knowledgeRows.ts`)
 * and the commands (`knowledgeCommands.ts`).
 */

import * as vscode from "vscode";
import {
  buildStoredGraph, claimSimilarity, createReviewRecorder, indexedSymbolSource, migratingRootFiles, planKnowledgeReviewDetail, repoGraphEdgeCount, reviewIndexPort, reviewPacks, rootPorts, runKnowledgeReview,
  workspaceCodeAnalyzers,
  type FsDirectorySource, type KnowledgeReviewOptions, type KnowledgeReviewPorts, type RepoGraphPort, type ReviewRecorder,
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
import { fileManifest, manifestFileName, selectKnowledgeStore, type KnowledgeFiles } from "./knowledgeStores";
import { legacyRootIdOf, rememberRoot, rootById, type KnowledgeRoot, type RootsMemento, type WorkspaceFolderRef } from "./knowledgeRoots";
import { editorJudgement } from "./knowledgeJudgement";
import { reviewRecords, useRecordMemento } from "./knowledgeSyncStatus";

/** Hashes remembered across reviews, so a re-review re-hashes only what changed on disk. */
const hashCache: HashCache = new Map();

/** Where the reviewed roots are listed (`workspaceState`), set at activation. */
let reviewedRootsMemento: RootsMemento | undefined;
export function configureKnowledgeHost(memento: RootsMemento): void {
  reviewedRootsMemento = memento;
  useRecordMemento(memento);
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
  store: KnowledgeStore;
  client?: KnowledgeClient;
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
 * A root, opened. Its manifest is the root's ONE record in this process, and its store the
 * ONE store for the project it is linked to (`rootPorts`): the review, the live watcher and
 * the graph reads all go through them, so a watcher can never write back a snapshot older
 * than a review's — linked or not, they share the manifest file's single handle.
 */
export function openRoot(secrets: vscode.SecretStorage, root: KnowledgeRoot): OpenRoot {
  const files = rootKnowledgeFiles(root);
  const client = linkedKnowledgeClient(secrets);
  const ports = rootPorts(root.rootId, {
    store: () => selectKnowledgeStore({ rootId: root.rootId, files, ...withClient(client) }).store,
    manifest: () => fileManifest(files, manifestFileName(root.rootId)),
  }, { variant: String(getSelectedProject()?.id ?? "local"), location: root.folderPath });
  return {
    root,
    source: createDirectorySource({ fs: vscodeKnowledgeFs(), rootPath: root.rootPath, rootId: root.rootId, title: root.title, hashCache }),
    store: ports.store,
    ...(client ? { client } : {}),
    manifest: ports.manifest,
    files,
  };
}

const withClient = (client: KnowledgeClient | undefined) => (client ? { client } : {});

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
async function reviewPorts(secrets: vscode.SecretStorage, open: OpenRoot, recorder: ReviewRecorder): Promise<KnowledgeReviewPorts> {
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
    analyzers: workspaceCodeAnalyzers({
      caps,
      partitions,
      repoGraph: measuringRepoMap(recorder),
      ...(root.rel ? { path: root.rel } : {}),
      ...(client ? { upload: (sha: string, snapshot: unknown) => client.putAnalysis(sha, snapshot as AnalysisSnapshotPayload) } : {}),
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
    ...(client ? { platformGraph: (rootId: string) => client.graph(rootId) } : {}),
    onIndexError: (error) => log("index upsert", error),
  };
}

/** A review of one root: plan first (no writes), then the review on that plan once confirmed (no re-walk). */
export interface RootReview {
  open: OpenRoot;
  plan(force?: boolean): Promise<PlanDetail>;
  run(opts: KnowledgeReviewOptions): Promise<ReviewReport>;
}

/** Listeners told when a root's knowledge changed (a review finished): the live graph re-reads. */
const changedListeners = new Set<(rootId: string) => void>();
export function onKnowledgeChanged(cb: (rootId: string) => void): () => void {
  changedListeners.add(cb);
  return () => changedListeners.delete(cb);
}

export function reviewRoot(secrets: vscode.SecretStorage, root: KnowledgeRoot): RootReview {
  const open = openRoot(secrets, root);
  // What this review skips (plan, folders, coverage, uploads during the run) is recorded per root for the sync status.
  const recorder = createReviewRecorder({ rootId: root.rootId, store: reviewRecords, ...(open.client ? { client: open.client } : {}), folders: () => open.source.skippedFolders() });
  let ports: Promise<KnowledgeReviewPorts> | undefined;
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
      const report = await runKnowledgeReview(p, opts);
      recorder.finish();
      for (const cb of changedListeners) cb(root.rootId);
      return report;
    },
  };
}

/** How the view reads a root's graph: the refs to load around, and the node cap. */
export interface GraphQuery { focus?: string[]; maxNodes?: number }

/** A root's graph: the platform's when linked, else built here from the local store. */
export async function loadGraph(
  secrets: vscode.SecretStorage,
  rootId: string,
  q: GraphQuery = {},
): Promise<KnowledgeGraph | null> {
  const client = linkedKnowledgeClient(secrets);
  if (client) return client.graph(rootId, { ...(q.focus ? { focus: q.focus } : {}), ...(q.maxNodes ? { maxNodes: q.maxNodes } : {}) });
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
