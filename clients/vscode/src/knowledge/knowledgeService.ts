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
  buildStoredGraph, createReviewRecorder, deferredHashCache, migratingRootFiles, reviewPacks,
  rootManifest, rootStore, runKnowledgeReview,
  type FsDirectorySource, type KnowledgeReviewOptions,
} from "@builderforce/agent-tools/knowledge";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import { gitIndexHints } from "@builderforce/agent-tools/node-knowledge-store";
import { createKnowledgeClient, type KnowledgeClient } from "@builderforce/knowledge-client";
import type { KnowledgeGraph, KnowledgeStore, LocalSnapshotStore, PlanDetail, ReviewReport } from "@seanhogg/builderforce-memory/knowledge";
import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { NOT_SIGNED_IN } from "@seanhogg/builderforce-brain-embedded";
import { fetchAuthed, type AuthedInit } from "../bfApi";
import { getSelectedProject } from "../projectState";
import { currentCapabilityInputs } from "../capabilityContext";
import { workspaceLinked } from "../capabilityStates";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { logLine } from "../errorReporter";
import { getHostKnowledgeIndex } from "./index/hostKnowledgeIndex";
import { vscodeKnowledgeFs, workspaceKnowledgeFiles } from "./knowledgeFs";
import { createDirectorySource } from "./vscodeDirectorySource";
import type { KnowledgeFiles } from "./knowledgeStores";
import { openRootKnowledge, rootMigration } from "./folderKnowledge";
import { configureReplicaLog, duringReview, replicatedStoreOf, type PumpSource } from "./knowledgeReplica";
import { legacyRootIdOf, rememberRoot, rootById, type KnowledgeRoot, type RootsMemento, type WorkspaceFolderRef } from "./knowledgeRoots";
import type { TrackedJudgement } from "./knowledgeJudgement";
import { reviewPortsFor } from "./reviewPortsFor";
import { reviewRecords, useRecordMemento } from "./knowledgeSyncStatus";
import { reviewParallelism } from "./review/extractPoolHost";
import { UNTIMED, type LoadTimer } from "./knowledgeLoadTrace";

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

/**
 * The selected project when the workspace is LINKED to it (PRD 41 A2): a project is selected, a session
 * exists AND `synchronize` is granted. A selection persisted while signed out is a pending binding, not
 * a link, so a review on it uses the local store and never throws `NOT_SIGNED_IN`.
 */
export function linkedProject(): ReturnType<typeof getSelectedProject> {
  const project = getSelectedProject();
  const { signedIn, synchronize } = currentCapabilityInputs();
  return workspaceLinked({ hasProject: !!project, signedIn, synchronize }) ? project : undefined;
}

/** The knowledge client for the linked project; undefined when the workspace is not linked. */
export function linkedKnowledgeClient(secrets: vscode.SecretStorage): KnowledgeClient | undefined {
  const project = linkedProject();
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
  local: LocalSnapshotStore;
  client?: KnowledgeClient;
  /** Present when linked: what the replica pump needs. */
  pump?: PumpSource;
  manifest: IngestManifest;
  files: KnowledgeFiles;
  /** Resolves when the root's legacy files are imported into the folder's SQLite store (a review awaits it before it reads). */
  migrated: Promise<void>;
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
  // The folder's ONE SQLite store and manifest (G03): the manifest commits in the same transaction as the facts.
  const folder = () => openRootKnowledge(root.folderPath, rootId, files, legacyRootIdOf(root), { info: (line) => logLine(`[knowledge] ${line}`), error: log });
  const local = rootStore(rootId, () => folder().store, "local");
  const manifest = rootManifest(rootId, () => folder().manifest, root.folderPath);
  const projectId = linkedProject()?.id;
  // The plan's stat manifest lives in the folder's SQLite file (PRD 41 B2): a re-plan after a restart re-reads only what changed.
  const hashCache = deferredHashCache(() => folder().hashCache);
  const pump: PumpSource | undefined = client && projectId !== undefined ? { rootId, files, local, client, projectId, manifest, sizeOf: (p: string) => hashCache.sizeOf?.(rootId, p) } : undefined;
  return {
    root,
    source: createDirectorySource({
      fs: vscodeKnowledgeFs(), rootPath: root.rootPath, rootId, title: root.title, hashCache,
      gitHints: (path) => gitIndexHints(path),
      onHashCacheError: (error) => log("stat manifest", error),
    }),
    // A kicked pump resolves its source when it STARTS, never holding the client of a project the workspace left.
    store: replicatedStoreOf(rootId, files, local, pump, !!opts.readThrough, () => openRoot(secrets, root).pump),
    local,
    ...(client ? { client } : {}),
    ...(pump ? { pump } : {}),
    manifest,
    files,
    migrated: rootMigration(root.folderPath, rootId),
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
  // A host without configuration (a test double) gets the default.
  const n = Math.floor(Number(vscode.workspace.getConfiguration?.("builderforce")?.get<number>("knowledge.judgeBudgetFiles", 500) ?? 500));
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
  const recorder = createReviewRecorder({ rootId: root.rootId, store: reviewRecords, folders: () => open.source.skippedFolders() });
  const ports = reviewPortsFor({ secrets, open, recorder, log });
  return {
    open,
    async plan(force) {
      await open.migrated;
      const planned = await ports.plan({ force: !!force });
      recorder.planned(planned.plan);
      // The confirm chip states the file budget of the judge pass too (PRD 41 A10).
      return { ...planned, plan: { ...planned.plan, judgeFiles: judgeBudgetFiles() } };
    },
    async run(opts) {
      await open.migrated;
      const p = await ports.full();
      if (reviewedRootsMemento) await rememberRoot(reviewedRootsMemento, root.rootId);
      // The shared runner feeds the knowledge index (reported as the `index` phase).
      recorder.begin();
      return duringReview(root.rootId, open.files, open.pump, async () => {
        // Extraction runs in the worker pool and judging N wide (PRD 41 A8); the caller's options win.
        const report = await runKnowledgeReview(p, { ...reviewParallelism(p.symbolLookup, root.rootPath), judgeFiles: judgeBudgetFiles(), ...opts });
        recorder.finish();
        for (const cb of changedListeners) cb(root.rootId);
        return report;
      });
    },
    async judgeModel() {
      const judgement = (await ports.full()).judgement as Partial<TrackedJudgement> | undefined;
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
 *
 * `timer` times its phases for the view's first-load diagnostics (`knowledgeLoadTrace.ts`); `onNearDuplicates`
 * hears how many near-duplicate pairs the build got. Neither changes what is read or built.
 */
export async function loadGraph(
  secrets: vscode.SecretStorage,
  rootId: string,
  q: GraphQuery = {},
  timer: LoadTimer = UNTIMED,
  onNearDuplicates?: (pairs: number) => void,
): Promise<KnowledgeGraph | null> {
  const root = rootById(rootId, workspaceFolders());
  if (!root) return null;
  const open = openRoot(secrets, root);
  // Read in parallel: the partitions and the index are independent inputs to the build.
  const [partitions, index] = await Promise.all([
    timer.phase("partitions", () => readPartitions({ caps: buildLocalCapabilityProvider(root.folderPath) })),
    timer.phase("index", () => getHostKnowledgeIndex(rootId).catch(() => undefined)),
  ]);
  const nearDuplicates = index ? timer.phase("nearDuplicates", () => index.nearDuplicates()) : undefined;
  if (nearDuplicates) onNearDuplicates?.(nearDuplicates.length);
  return timer.phase("build", () => buildStoredGraph({
    rootId, store: open.store, manifest: open.manifest, packs: reviewPacks({ partitions }),
    ...(nearDuplicates ? { nearDuplicates } : {}),
    ...(q.focus ? { focus: q.focus } : {}),
    ...(q.maxNodes ? { maxNodes: q.maxNodes } : {}),
  }));
}
