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
import { buildStoredGraph, createReviewRecorder, deferredHashCache, migratingRootFiles, reviewPacks, rootManifest, rootStore, runKnowledgeReview, } from "@builderforce/agent-tools/knowledge";
import { readPartitions } from "@builderforce/agent-tools/prefetch";
import { gitBlobId, gitIndexHints } from "@builderforce/agent-tools/node-knowledge-store";
import { createKnowledgeClient } from "@builderforce/knowledge-client";
import { NOT_SIGNED_IN } from "@seanhogg/builderforce-brain-embedded";
import { fetchAuthed } from "../bfApi";
import { getSelectedProject } from "../projectState";
import { currentCapabilityInputs } from "../capabilityContext";
import { workspaceLinked } from "../capabilityStates";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { logLine } from "../errorReporter";
import { getHostKnowledgeIndex } from "./index/hostKnowledgeIndex";
import { vscodeKnowledgeFs, workspaceKnowledgeFiles } from "./knowledgeFs";
import { createDirectorySource, EVENT_LOOP_YIELD_EVERY, eventLoopYield } from "./vscodeDirectorySource";
import { openRootKnowledge, rootMigration } from "./folderKnowledge";
import { configureReplicaLog, duringReview, replicatedStoreOf } from "./knowledgeReplica";
import { legacyRootIdOf, rememberRoot, rootById } from "./knowledgeRoots";
import { reviewPortsFor } from "./reviewPortsFor";
import { reviewRecords, useRecordMemento } from "./knowledgeSyncStatus";
import { reviewParallelism } from "./review/extractPoolHost";
import { UNTIMED } from "./knowledgeLoadTrace";
import { factFindingsProvider, factIndexOf } from "./factFindings";
import { preemptBackground } from "./indexLevels";
import { untilAborted } from "../boundedStep";
/** Where the reviewed roots are listed (`workspaceState`), set at activation. */
let reviewedRootsMemento;
export function configureKnowledgeHost(memento) {
    reviewedRootsMemento = memento;
    useRecordMemento(memento);
    configureReplicaLog(log);
}
export const log = (what, error) => logLine(`[knowledge] ${what}: ${error instanceof Error ? error.message : String(error)}`);
/** The open workspace folders. */
export function workspaceFolders() {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => ({ path: f.uri.fsPath }));
}
/**
 * The selected project when the workspace is LINKED to it (PRD 41 A2): a project is selected, a session
 * exists AND `synchronize` is granted. A selection persisted while signed out is a pending binding, not
 * a link, so a review on it uses the local store and never throws `NOT_SIGNED_IN`.
 */
export function linkedProject() {
    const project = getSelectedProject();
    const { signedIn, synchronize } = currentCapabilityInputs();
    return workspaceLinked({ hasProject: !!project, signedIn, synchronize }) ? project : undefined;
}
/** The knowledge client for the linked project; undefined when the workspace is not linked. */
export function linkedKnowledgeClient(secrets) {
    const project = linkedProject();
    if (!project)
        return undefined;
    return createKnowledgeClient({
        projectId: project.id,
        fetch: async (path, init) => {
            const res = await fetchAuthed(secrets, path, init);
            if (!res)
                throw new Error(NOT_SIGNED_IN);
            return res;
        },
    });
}
/**
 * A root's local knowledge files (`.builderforce/knowledge/` of its workspace folder). A
 * root reviewed under its old, name-based id keeps its local graph: migrated on first read.
 */
export function rootKnowledgeFiles(root) {
    return migratingRootFiles(workspaceKnowledgeFiles(root.folderPath), root.rootId, legacyRootIdOf(root));
}
/**
 * A root, opened. Its manifest and its LOCAL store are the root's ONE record in this process
 * (`rootStore` / `rootManifest`): the review, the live watcher and the graph reads all go through
 * them, so a watcher can never write back a snapshot older than a review's. The returned `store`
 * wraps that local store for replication; `readThrough` (the "Use the server's copy" seed) lets the
 * review seed its extracted cache from the project before it extracts.
 */
export function openRoot(secrets, root, opts = {}) {
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
    const pump = client && projectId !== undefined ? { rootId, files, local, client, projectId, manifest, sizeOf: (p) => hashCache.sizeOf?.(rootId, p) } : undefined;
    return {
        root,
        source: createDirectorySource({
            fs: vscodeKnowledgeFs(), rootPath: root.rootPath, rootId, title: root.title, hashCache,
            gitHints: (path) => gitIndexHints(path),
            gitBlobId,
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
/** `builderforce.knowledge.judgeBudgetFiles` (PRD 41 A10): files judged per run after the map is complete; default 500, never negative. */
const judgeBudgetFiles = () => {
    // A host without configuration (a test double) gets the default.
    const n = Math.floor(Number(vscode.workspace.getConfiguration?.("builderforce")?.get("knowledge.judgeBudgetFiles", 500) ?? 500));
    return Number.isFinite(n) && n >= 0 ? n : 500;
};
/** Listeners told when a root's knowledge changed (a review finished): the live graph re-reads. */
const changedListeners = new Set();
export function onKnowledgeChanged(cb) {
    changedListeners.add(cb);
    return () => changedListeners.delete(cb);
}
/**
 * `seed` is "Use the server's copy": a local review with a server read-through — the extractor asks
 * the project's bulk extracted route for the files' content hashes first, so unchanged files cost no
 * model call (offline, the same review runs without it).
 */
export function reviewRoot(secrets, root, opts = {}) {
    // `open` / `recorder`: a root already opened and its recorder (the background indexer keeps ONE of each for its life, so
    // its source and stat manifest carry over from cycle to cycle while the run ports are made fresh).
    const open = opts.open ?? openRoot(secrets, root, { readThrough: !!opts.seed });
    // What this review skips (plan, folders, coverage, uploads during the run) is recorded per root for the sync status.
    // Records land only in `finish()`, which only `run` calls: a background `mapPass` never writes the sync status.
    const recorder = opts.recorder ?? createReviewRecorder({ rootId: root.rootId, store: reviewRecords, folders: () => open.source.skippedFolders() });
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
            // A background indexer pass on this root stops first (it reruns after), and none starts again until this review holds
            // the root itself (released inside `duringReview` below, or when the setup fails): the person's review never waits behind one.
            const release = await preemptBackground(root.rootId);
            try {
                const p = await ports.full();
                if (reviewedRootsMemento)
                    await rememberRoot(reviewedRootsMemento, root.rootId);
                // The shared runner feeds the knowledge index (reported as the `index` phase).
                recorder.begin();
                return await duringReview(root.rootId, open.files, open.pump, async () => {
                    release(); // the root is held by this review now
                    // Extraction runs in the worker pool and judging N wide (PRD 41 A8); the caller's options win.
                    const report = await runKnowledgeReview(p, { ...reviewParallelism(p.symbolLookup, root.rootPath), judgeFiles: judgeBudgetFiles(), ...opts });
                    recorder.finish();
                    for (const cb of changedListeners)
                        cb(root.rootId);
                    return report;
                });
            }
            finally {
                release();
            }
        },
        async judgeModel() {
            const judgement = (await ports.full()).judgement;
            return judgement?.modelsUsed?.().join(", ") || undefined;
        },
        async backgroundPlan() {
            await open.migrated;
            return ports.plan({ force: false, background: true });
        },
        async mapPass({ plan, analyzers, signal }) {
            // Every setup step yields to the pass's signal: a preemption, a keystroke or shutdown never waits on a slow port.
            await untilAborted(open.migrated, signal);
            const p = await untilAborted(ports.mapOnly(analyzers), signal);
            signal.throwIfAborted();
            return duringReview(root.rootId, open.files, open.pump, async () => {
                signal.throwIfAborted();
                // Map only (`judgeFiles: 0`, no judge port): no model call; the files it does not reach stay owed.
                const report = await runKnowledgeReview(p, { ...reviewParallelism(p.symbolLookup, root.rootPath), plan, judgeFiles: 0, signal });
                for (const cb of changedListeners)
                    cb(root.rootId);
                return report;
            });
        },
    };
}
/**
 * A root's graph, ALWAYS built here from the local store (PRD 41 A7) — linked or not, online or
 * not: the cut, the outline and every badge are computed from the local projection, so the map
 * never depends on the server. Null when this machine holds no review of the root.
 *
 * `timer` times its phases for the view's first-load diagnostics (`knowledgeLoadTrace.ts`); `onNearDuplicates`
 * hears how many near-duplicate pairs the build got. Neither changes what is read or built.
 */
export async function loadGraph(secrets, rootId, q = {}, timer = UNTIMED, onNearDuplicates) {
    const root = rootById(rootId, workspaceFolders());
    if (!root)
        return null;
    const open = openRoot(secrets, root);
    // Read in parallel: the partitions and the index are independent inputs to the build.
    const [partitions, index] = await Promise.all([
        timer.phase("partitions", () => readPartitions({ caps: buildLocalCapabilityProvider(root.folderPath) })),
        timer.phase("index", () => getHostKnowledgeIndex(rootId).catch(() => undefined)),
    ]);
    const nearDuplicates = index ? timer.phase("nearDuplicates", () => index.nearDuplicates()) : undefined;
    if (nearDuplicates)
        onNearDuplicates?.(nearDuplicates.length);
    const packs = reviewPacks({ partitions });
    // The generic and code-pack findings come from the root's fact index (PRD 41 §B5), over the whole graph, once it synced.
    const findings = factFindingsProvider(factIndexOf(rootId));
    return timer.phase("build", () => buildStoredGraph({
        rootId, store: open.store, manifest: open.manifest, packs,
        // The extension host is the webview bridge: hand its event loop a macrotask every so
        // many per-file reads, so a large root's load does not starve pending bridge work for
        // the whole walk (the per-file reads resolve synchronously — node:sqlite + a cached
        // parse — which otherwise drains only microtasks between iterations).
        yieldEvery: EVENT_LOOP_YIELD_EVERY,
        yieldDelay: eventLoopYield,
        ...(nearDuplicates ? { nearDuplicates } : {}),
        ...(q.focus ? { focus: q.focus } : {}),
        ...(q.maxNodes ? { maxNodes: q.maxNodes } : {}),
        ...(findings ? { findings } : {}),
    }));
}
//# sourceMappingURL=knowledgeService.js.map