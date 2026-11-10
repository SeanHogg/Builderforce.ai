/**
 * knowledge/reviewRunner.ts — ONE review composition for every host that reviews in its
 * own process (VS Code's extension host, the on-prem agent runtime) — PRD 38 §4.3, §4.7.
 *
 * A host injects ports only: where files come from (`DirectorySource`), where knowledge is
 * kept (`KnowledgeStore`), the per-root `IngestManifest`, a `JudgementPort`, the knowledge
 * index's `similar`, its symbol lookup and its analyzer run. This composes them with the
 * ONE pack list (`knowledgePacks` — code before docs) and memory's `planReview` /
 * `reviewDirectory`, at the operator's default budget (200 judged sections, §8.2).
 *
 * It also builds a root's graph from what a review left in the store (an unlinked folder:
 * the extracted cache by content hash, the stored facts and relations), and runs the code
 * pack's analyzers through the host's shell, uploading the snapshot when asked. Pure:
 * every I/O goes through an injected port.
 */

import {
    DEFAULT_REVIEW_MODEL_CALLS, planDetail, reviewDirectory, srcRef,
    type AnalyzerPort, type DirectorySource, type Extracted, type ExtractJob, type ExtractPool, type JudgementPort, type ReviewStep, type KnowledgeGraph,
    type KnowledgePack, type KnowledgeStore, type LiveOverlay, type NodeRef, type PartitionRegistry, type PlanDetail, type ReviewPlan,
    type ReviewArgs, type ReviewProgress, type ReviewReport, type SimilarPair,
} from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import type { CapabilityProvider } from '../capabilities.js';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { codeAnalyzers } from './codeAnalyzers.js';
import { isCodePath, type SymbolSource } from './codePack.js';
import { readEntryPaths } from './codeEntryPoints.js';
import { buildCodeGraph } from './codeGraph.js';
import { listedModuleResolution } from './codeRollup.js';
import { loadModuleAliases } from './moduleAliasLoader.js';
import type { ModuleResolution } from './moduleAliases.js';
import { withRootSignals } from './codeRootSignals.js';
import type { CoverageRoot, CoverageSkip } from './codeCoverage.js';
import { currentFileHashes, pruneEditedFiles } from './fileEdits.js';
import type { HistoryPort } from './historyPort.js';
import type { HostKnowledgeIndex } from './index/contract.js';
import { knowledgePacks } from './knowledgePacks.js';
import { noteGraphReads } from './graphReads.js';
import { repoGraphUnder, snapshotUnder } from './rootRelative.js';
import { runPreemptingJudge, type RunHandoff } from './reviewRunLock.js';
import { readSystems, recordSystems } from './systemsRecord.js';
import { analyseWorkspace, type RepoGraphPort } from './workspaceAnalysis.js';
import { fingerprintSha } from './workspaceFingerprint.js';
import { runJudgePass } from './reviewJudgePass.js';
import { directoryArgs } from './reviewDirectoryArgs.js';
import { isLandingManifest, landingManifest } from './landingManifest.js';

/** Judged sections per review before the chip asks again (PRD 38 §8.2). */
export const KNOWLEDGE_REVIEW_MODEL_CALLS = DEFAULT_REVIEW_MODEL_CALLS;

/** Manifest entry naming the root-level analyzer outputs of a root's last review. */
export const analysisManifestKey = (rootId: string): string => `knowledge:${rootId}:analysis`;

/** What of the host's knowledge index a review feeds (`HostKnowledgeIndex.upsertFromGraph` / `discardProvisional`). */
export interface ReviewIndexPort {
    upsertFromGraph(graph: KnowledgeGraph): Promise<void>;
    /** Drops the claim cards `similar` added that no graph upsert backed (a run that stopped early). Required: omitting it leaves them behind and blocks idle saves. */
    discardProvisional(): Promise<void>;
}

/** The review's index port over a host's (lazily opened) knowledge index — ONE adapter for every host. */
export function reviewIndexPort(index: () => Promise<Pick<HostKnowledgeIndex, 'upsertFromGraph' | 'discardProvisional'>>): ReviewIndexPort {
    return {
        upsertFromGraph: async (graph) => (await index()).upsertFromGraph(graph),
        discardProvisional: async () => (await index()).discardProvisional(),
    };
}

export interface KnowledgeReviewPorts {
    source: DirectorySource;
    store: KnowledgeStore;
    manifest: IngestManifest;
    judgement?: JudgementPort;
    /** Near-duplicate pairs from the knowledge index (claims to compare). */
    similar?(ids: string[], texts?: ReadonlyMap<string, string>): Promise<SimilarPair[]>;
    /** Definitions per file from the host's warm symbol index. */
    symbolsOf?: SymbolSource;
    /** The code pack's analyzer run (see {@link workspaceCodeAnalyzers}). */
    analyzers?: AnalyzerPort;
    /** The code layers (`.builderforce/partitions.json` or the default). */
    partitions?: PartitionRegistry;
    /** OPTIONAL version history: with it code files carry `churn` and `coChange` badges (see `gitHistoryPort`); without it, neither. */
    history?: HistoryPort;
    /** OPTIONAL reviewed folder on disk: coverage files and CODEOWNERS are read from it for the `coverage` and `owner` badges. */
    rootFiles?: CoverageRoot;
    /** Told what the root signals left out (stale or oversize coverage), for the sync status. */
    onSignalsSkipped?(skipped: readonly CoverageSkip[]): void;
    /** The host's knowledge index: fed the root's graph once the review is done (§4.3, last step), reported as the `index` phase. */
    index?: ReviewIndexPort;
    /** A linked host's platform graph of the root; null or a failure ⇒ the graph is built from the store. */
    platformGraph?(rootId: string): Promise<KnowledgeGraph | null>;
    /** A failed index update is reported, never a failed review. Must not throw (the runner calls it from its cleanup). */
    onIndexError?(error: unknown): void;
    /** A failure to record the root's systems is reported, never a failed review. Must not throw. */
    onSystemsError?(error: unknown): void;
    /**
     * The root's path aliases and which modules exist, for the code pack's per-file extract (`moduleAliases.ts`). Absent ⇒ a
     * run reads them ONCE from its `source` over the files it lists ({@link rootModuleResolution}).
     */
    modules?: ModuleResolution;
}

export interface KnowledgeReviewOptions {
    /** *Re-review all*: every file is planned as changed whatever the manifest holds (memory's `force`); judged sections whose text is unchanged are not judged again. */
    force?: boolean;
    /** The plan the person confirmed ({@link planKnowledgeReviewDetail}): reused without a re-walk (*Continue*, §4.3). */
    plan?: PlanDetail;
    /** Default {@link KNOWLEDGE_REVIEW_MODEL_CALLS}. */
    modelCalls?: number;
    /**
     * Ceiling for ONE judgement request (per judged file / compare pair) before it is treated as
     * unjudged, default {@link DEFAULT_JUDGEMENT_TIMEOUT_MS}. A stalled engine (a completion that
     * never resolves) otherwise hangs the whole review at the `judge` phase; with the timeout the
     * affected sections stay unjudged and a later run judges them again.
     */
    judgementTimeoutMs?: number;
    signal?: AbortSignal;
    onProgress?(p: ReviewProgress): void;
    /** One event per file per phase (PRD 41 A8), for a host's run record. */
    onStep?(step: ReviewStep): void;
    /** Extracts changed files off the host's thread (a `worker_threads` pool). Absent ⇒ in-thread, as before. */
    extractPool?: ExtractPool;
    /** Files read and extracted ahead of judging; with a pool, the pool's width. Absent ⇒ memory's default. */
    concurrency?: number;
    /** Files judged at once. Absent ⇒ memory's default. */
    judgeConcurrency?: number;
    /** Most model calls in flight across the review. Absent ⇒ memory's default. */
    maxModelCalls?: number;
    /** Two passes (PRD 41 A10): pass 1 maps with no model call (phase `mapped`), pass 2 judges up to this many files in priority order; the rest stay owed. 0 = map only. Absent = one pass. */
    judgeFiles?: number;
    /** The pool reads files itself (see memory's `ReviewArgs.deferRead`). */
    deferRead?: boolean;
    /** Files read ahead of the writer (memory's default: wider than the pool). */
    readAhead?: number;
    /** Per-job ceilings of the extract path (memory's defaults: reads 5 s, extract 10 s). */
    timeouts?: { readMs?: number; extractMs?: number };
}

/** The analyzers, recording which root-level outputs the last run produced (for {@link buildStoredGraph}). */
function recordingAnalyzers(inner: AnalyzerPort, manifest: IngestManifest): AnalyzerPort {
    return {
        async analyse(rootId, signal) {
            const out = await inner.analyse(rootId, signal);
            const entries = out.map((e) => ({ id: e.sourceRef, hash: e.sourceHash }));
            // The review stores these outputs AFTER this returns: the entry lands with or after them, never ahead (landingManifest.ts).
            if (isLandingManifest(manifest)) manifest.hold(analysisManifestKey(rootId), entries);
            else await manifest.set(analysisManifestKey(rootId), entries);
            return out;
        },
    };
}

/** The files a review saw: its confirmed plan's (no second walk), else one listing of the source. Manifests the plan skipped as `no-pack` are included (entry points come from them). */
function reviewedPaths(source: DirectorySource | undefined, plan: PlanDetail | undefined): () => Promise<string[]> {
    return async () => {
        if (plan) return [...plan.files.map((f) => f.path), ...plan.plan.skipped.map((f) => f.path)];
        const paths: string[] = [];
        if (source) for await (const f of source.list()) paths.push(f.path);
        return paths;
    };
}

/** The ONE pack list, with this host's symbols, analyzers and layers. */
export function reviewPacks(
    ports: Pick<KnowledgeReviewPorts, 'symbolsOf' | 'analyzers' | 'partitions' | 'history' | 'rootFiles' | 'onSignalsSkipped' | 'modules'> & { source?: DirectorySource },
    manifest?: IngestManifest,
    /** The review's confirmed plan: the files the signals are read for (default: one listing of the source). */
    plan?: PlanDetail,
): KnowledgePack[] {
    // Coverage, churn and owners are read once per review, alongside the analyzers (only a running review has a manifest to record them in).
    const source = ports.source;
    const signals = {
        ...(ports.history ? { history: ports.history } : {}),
        ...(ports.rootFiles ? { files: ports.rootFiles } : {}),
        ...(source ? { entryPaths: (candidates: readonly string[]) => readEntryPaths(source, candidates) } : {}),
        ...(ports.onSignalsSkipped ? { onSkipped: ports.onSignalsSkipped } : {}),
    };
    const withSignals = manifest ? withRootSignals(ports.analyzers, signals, reviewedPaths(source, plan)) : ports.analyzers;
    const analyzers = withSignals && manifest ? recordingAnalyzers(withSignals, manifest) : withSignals;
    return knowledgePacks({
        ...(ports.symbolsOf ? { symbolsOf: ports.symbolsOf } : {}),
        ...(analyzers ? { analyzers } : {}),
        ...(ports.partitions ? { partitions: ports.partitions } : {}),
        ...(ports.modules ? { modules: ports.modules } : {}),
    });
}

/**
 * THE way any extract path gets a root's {@link ModuleResolution}: its alias configs read through `source` (only those
 * among the listed files), and module existence answered from the same listing (the plan's files, else one listing).
 * A review reads it once per run; a watcher or a run delta once per start (a host may keep it until a config changes).
 */
export async function rootModuleResolution(source: DirectorySource, plan?: PlanDetail): Promise<ModuleResolution> {
    const paths = await reviewedPaths(source, plan)();
    const listed = new Set(paths);
    const read = async (path: string): Promise<string | undefined> => {
        const doc = await source.read(path);
        return doc.content.kind === 'text' ? doc.content.text : undefined;
    };
    return listedModuleResolution(await loadModuleAliases(paths.filter(isCodePath), read, { listed }), listed);
}

/**
 * The run's extract pool with the root's aliases on every job: a worker builds its own packs, so it gets the aliases as
 * data (`aliases`) and answers module existence itself.
 */
function poolWithAliases(pool: ExtractPool | undefined, modules: ModuleResolution): ExtractPool | undefined {
    if (!pool || modules.aliases.scopes.length === 0) return pool;
    return (job, signal) => pool(Object.assign({}, job, { aliases: modules.aliases }) as ExtractJob, signal);
}

/**
 * Whether a run on these ports compares near-duplicate claims — memory's rule: it needs both a
 * judgement port and `similar`. The plan counts compare calls only then, so the confirm chip
 * never states calls the run will not spend (a host without `similar`, like the browser's, plans none).
 */
function willCompare(ports: Pick<KnowledgeReviewPorts, 'judgement' | 'similar'>): boolean {
    return !!ports.judgement && !!ports.similar;
}

/** The confirm chip's numbers AND the walk behind them: hand it back as `plan` to run the review without re-walking. */
export function planKnowledgeReviewDetail(
    ports: KnowledgeReviewPorts,
    /** `compare` overrides the ports-derived answer: a host that knows a judge will be there, but has not started it, counts the compare calls. */
    opts: Pick<KnowledgeReviewOptions, 'force'> & { compare?: boolean } = {},
): Promise<PlanDetail> {
    return planDetail(ports.source, ports.manifest, reviewPacks(ports), { ...(opts.force ? { force: true } : {}), compare: opts.compare ?? willCompare(ports) });
}

/** The confirm chip's numbers: a walk plus a manifest diff, no reads of unchanged files. */
export async function planKnowledgeReview(ports: KnowledgeReviewPorts, opts: Pick<KnowledgeReviewOptions, 'force'> = {}): Promise<ReviewPlan> {
    return (await planKnowledgeReviewDetail(ports, opts)).plan;
}

/**
 * The review itself — only after the person confirmed the plan. Reviews of one root run one
 * at a time (a later run waits for the earlier one): a run's provisional-card cleanup and graph
 * upsert would otherwise drop the cards of another run still in flight on the same root's index.
 * A run queued behind another for the same root sees its abort signal only once it starts.
 */
export function runKnowledgeReview(ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions = {}): Promise<ReviewReport> {
    return runPreemptingJudge(ports.source.rootId, (handoff) => reviewOnce(ports, opts, handoff));
}

async function reviewOnce(ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions, handoff: RunHandoff): Promise<ReviewReport> {
    // With an index to feed, `done` is memory's last word but not the run's: it waits for the `index` phase.
    const held: { done?: ReviewProgress } = {};
    const progress: KnowledgeReviewOptions['onProgress'] = (ports.index || opts.judgeFiles !== undefined) && opts.onProgress
        ? (p) => { if (p.phase === 'done') held.done = p; else opts.onProgress!(p); }
        : opts.onProgress;
    // The listener's failure on a phase the runner emits itself (`index`, the held `done`) must not change what the run does: it waits for the end.
    const listener: { failure?: { error: unknown } } = {};
    const tell = (p: ReviewProgress): void => {
        try {
            opts.onProgress?.(p);
        } catch (error) {
            listener.failure ??= { error };
        }
    };
    const outcome: { report: ReviewReport } | { failure: { error: unknown } } = await reviewAndIndex(ports, opts, progress, tell, handoff).then(
        (report) => ({ report }),
        (error: unknown) => ({ failure: { error } }),
    );
    // However the run ended: no unwritten claim stays in the index, and the held `done` is forwarded once, last.
    // `Promise.resolve().then` also catches a port that throws before it returns its promise.
    await Promise.resolve().then(() => ports.index?.discardProvisional()).catch((error: unknown) => ports.onIndexError?.(error));
    if (held.done) tell(held.done);
    // The review's own error wins over the listener's; a listener that throws after a clean run is the caller's to see.
    if ('failure' in outcome) throw outcome.failure.error;
    if (listener.failure) throw listener.failure.error;
    return outcome.report;
}

const directoryArgsOf = (
    ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions, progress: KnowledgeReviewOptions['onProgress'], extra: Pick<ReviewArgs, 'mechanical' | 'only'> = {},
): ReviewArgs => {
    // One run, one landing manifest: what the analyzers produced is recorded only once the review has stored it.
    const manifest = landingManifest(ports.manifest);
    return directoryArgs({ ...ports, manifest }, opts, reviewPacks(ports, manifest, opts.plan), progress, KNOWLEDGE_REVIEW_MODEL_CALLS, extra);
};

async function reviewAndIndex(
    ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions, progress: KnowledgeReviewOptions['onProgress'],
    tell: (p: ReviewProgress) => void, handoff: RunHandoff,
): Promise<ReviewReport> {
    const twoPass = opts.judgeFiles !== undefined && !!ports.judgement;
    // Two passes share ONE plan: its manifest hashes are the last review's (what pass 2's "recent" compares against), and neither pass walks again.
    const plan = opts.plan ?? (twoPass ? await planKnowledgeReviewDetail(ports, opts.force ? { force: true } : {}) : undefined);
    // The root's aliases, once per run: every extract of it (in-thread or pooled, both passes) resolves with the same ones.
    const modules = ports.modules ?? await rootModuleResolution(ports.source, plan);
    ports = { ...ports, modules };
    const pool = poolWithAliases(opts.extractPool, modules);
    const passOpts: KnowledgeReviewOptions = { ...opts, ...(plan ? { plan } : {}), ...(pool ? { extractPool: pool } : {}) };
    const report = await reviewDirectory(directoryArgsOf(ports, passOpts, progress, twoPass ? { mechanical: true } : {}));
    // What was edited since the last review is superseded by the files this one judged (or dropped).
    await pruneEditedFiles(ports.manifest, report.rootId);
    // The root's systems (PRD 41 A9): detected from what this review saw, kept with it for the graph build.
    if (!report.aborted) {
        await recordSystems({
            rootId: report.rootId, rootName: ports.source.title, source: ports.source, manifest: ports.manifest,
            ...(opts.plan ? { plan: opts.plan } : {}),
        }).catch((error: unknown) => ports.onSystemsError?.(error));
    }
    const graph = await indexReviewed(ports, report.rootId, tell);
    if (!twoPass || report.aborted) return report;
    // The map is complete: say so, then judge in the background of the same run (PRD 41 A10).
    tell({ phase: 'mapped', done: report.awaitingJudge.length, total: report.awaitingJudge.length });
    return runJudgePass({ ports, opts: passOpts, mapped: report, graph, tell, handoff, directoryArgs: directoryArgsOf, indexReviewed, freshPlan: () => planKnowledgeReviewDetail(ports) });
}

/**
 * After a review: the root's graph feeds the host's knowledge index. THE one place a host's
 * index is updated from a review, reported as the `index` phase between `write` and `done`
 * (`total` = the graph's nodes) so the view can say it is indexing. Only the graph build and the
 * upsert are index work (a failure there is `onIndexError`); `tell` is the progress emitter and never throws.
 */
async function indexReviewed(ports: KnowledgeReviewPorts, rootId: string, tell: (p: ReviewProgress) => void): Promise<KnowledgeGraph | null> {
    const index = ports.index;
    if (!index) return null;
    let graph: KnowledgeGraph | null;
    try {
        graph = (await ports.platformGraph?.(rootId).catch(() => null))
            ?? await buildStoredGraph({ rootId, store: ports.store, manifest: ports.manifest, packs: reviewPacks(ports) });
    } catch (error) {
        ports.onIndexError?.(error);
        return null;
    }
    if (!graph) return null;
    const total = graph.nodes.length;
    tell({ phase: 'index', done: 0, total });
    try {
        await index.upsertFromGraph(graph);
    } catch (error) {
        ports.onIndexError?.(error);
        return graph;
    }
    tell({ phase: 'index', done: total, total });
    return graph;
}

export interface StoredGraphArgs {
    rootId: string;
    store: KnowledgeStore;
    manifest: IngestManifest;
    packs: KnowledgePack[];
    live?: LiveOverlay;
    nearDuplicates?: SimilarPair[];
    focus?: string[];
    maxNodes?: number;
    /**
     * Root-relative path → the content hash to read that file at instead of the stored one (`null`: the file is absent).
     * The run delta builds both sides of a run this way (PRD 41 C1): the stored graph with the run's changed files swapped
     * to their before (or after) extracts, which the caller has put in the store's extract cache under those hashes.
     */
    hashOverrides?: ReadonlyMap<string, string | null>;
}

/** The content hash of every file a stored graph reads: the review's (or a newer edit's), with `overrides` applied. */
export async function storedFileHashes(
    manifest: IngestManifest, rootId: string, overrides?: ReadonlyMap<string, string | null>,
): Promise<Map<string, string>> {
    const hashes = await currentFileHashes(manifest, rootId);
    for (const [path, hash] of overrides ?? []) {
        if (hash === null) hashes.delete(path);
        else hashes.set(path, hash);
    }
    return hashes;
}

/**
 * A root's graph built HERE, from what its reviews left in the store: each reviewed file's
 * extracted output (by the content hash the manifest holds, or the file's newer one once edited), the last analysis's root-level
 * output, and the stored facts and relations. Null when the root was never reviewed.
 */
export async function buildStoredGraph(args: StoredGraphArgs): Promise<KnowledgeGraph | null> {
    const { rootId, store, manifest } = args;
    // A file edited since its review is read at its NEW hash (`markFileEdited`), so its claims show stale.
    const files = [...(await storedFileHashes(manifest, rootId, args.hashOverrides))].map(([id, hash]) => ({ id, hash }));
    const roots = (await manifest.get(analysisManifestKey(rootId))) ?? [];
    if (files.length === 0 && roots.length === 0) return null;
    const extracted: Extracted[] = [];
    const wanted = [
        ...files.map((f) => ({ ref: srcRef(rootId, f.id) as string, hash: f.hash })),
        ...roots.map((r) => ({ ref: r.id, hash: r.hash })),
    ];
    for (const w of wanted) {
        // A deleted file has no content hash: there is nothing of it to fetch.
        if (!w.hash) continue;
        const hit = (await store.getExtracted?.(w.hash))?.find((e) => e.sourceRef === w.ref);
        if (hit) extracted.push(hit);
    }
    const [facts, relations, systems] = await Promise.all([store.facts({ rootId }), store.relations({ rootId }), readSystems(manifest, rootId)]);
    // The ONE graph builder for code: the default layers are resolved over the whole file graph (folder, name, import direction).
    return buildCodeGraph(
        {
            rootId, extracted, facts, relations, packs: args.packs,
            ...(systems.length > 0 ? { systems } : {}),
            ...(args.live ? { live: args.live } : {}),
            ...(args.nearDuplicates ? { nearDuplicates: args.nearDuplicates } : {}),
        },
        {
            ...(args.maxNodes ? { maxNodes: args.maxNodes } : {}),
            ...(args.focus?.length ? { focus: args.focus as NodeRef[] } : {}),
        },
    );
}

/**
 * The id a code-analysis snapshot is stored under (`PUT …/code-analysis/:sha`): its commit,
 * plus a digest of the uncommitted state when the tree was dirty — so two dirty snapshots of
 * one commit do not overwrite each other — else its own id.
 */
export function analysisSha(snapshot: CodeAnalysisSnapshot): string {
    return fingerprintSha(snapshot.source) ?? snapshot.id;
}

export interface WorkspaceAnalyzersDeps {
    /** The surface's capabilities — `shell` runs dependency-cruiser, jscpd and knip; `repoRead` feeds the repo map. */
    caps: CapabilityProvider;
    partitions?: PartitionRegistry;
    /** Workspace-relative folder to analyse (a reviewed sub-folder); absent ⇒ the whole tree. */
    path?: string;
    /** The repo map (`@builderforce/repo-map`'s `repoMapPort`): its `references` edges ride the analyzer output. */
    repoGraph?: RepoGraphPort;
    /** Linked hosts upload the snapshot (`client.putAnalysis`) so the web builds the same graph. */
    upload?(sha: string, snapshot: CodeAnalysisSnapshot): Promise<void>;
    /** A failed upload is reported, never a failed review. */
    onUploadError?(error: unknown): void;
    /** Told when the perception is partial (a truncated file listing). */
    onWarn?(message: string): void;
}

/** The code pack's analyzers over this host's shell and repo map (cached per sha), uploading the snapshot when asked. */
export function workspaceCodeAnalyzers(deps: WorkspaceAnalyzersDeps): AnalyzerPort {
    return codeAnalyzers({
        async run(rootId, signal, onProgress) {
            const { snapshot, repoGraph, graphReads } = await analyseWorkspace(
                {
                    caps: deps.caps,
                    rootId,
                    ...(deps.onWarn ? { onWarn: deps.onWarn } : {}),
                    ...(deps.path ? { path: deps.path } : {}),
                    ...(deps.partitions ? { partitions: deps.partitions } : {}),
                    ...(deps.repoGraph ? { repoGraph: deps.repoGraph } : {}),
                    ...(onProgress ? { onProgress } : {}),
                },
                signal,
            );
            // What the repo graph read of each system goes to the systems record the review writes (see `recordSystems`).
            noteGraphReads(rootId, graphReads);
            // The analyzers name files relative to the workspace; this root's files (its manifest,
            // its refs, the platform's graph of it) are relative to the root itself — the upload too.
            const scoped = snapshot && deps.path ? snapshotUnder(snapshot, deps.path) : snapshot;
            if (scoped && deps.upload) {
                await deps.upload(analysisSha(scoped), scoped).catch((error: unknown) => deps.onUploadError?.(error));
            }
            return {
                analysis: scoped,
                repoGraph: repoGraph && deps.path ? repoGraphUnder(repoGraph, deps.path) : repoGraph,
            };
        },
    });
}
