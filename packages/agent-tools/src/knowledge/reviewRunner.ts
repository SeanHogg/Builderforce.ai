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
    buildGraph, DEFAULT_REVIEW_MODEL_CALLS, planDetail, reviewDirectory, srcRef,
    type AnalyzerPort, type DirectorySource, type Extracted, type JudgementPort, type KnowledgeGraph,
    type KnowledgePack, type KnowledgeStore, type LiveOverlay, type NodeRef, type PartitionRegistry, type PlanDetail, type ReviewPlan,
    type ReviewProgress, type ReviewReport, type SimilarPair,
} from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import type { CapabilityProvider } from '../capabilities.js';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { extractSymbols, type CodeSymbol } from '../symbols.js';
import { codeAnalyzers } from './codeAnalyzers.js';
import type { SymbolSource } from './codePack.js';
import { currentFileHashes, pruneEditedFiles } from './fileEdits.js';
import type { HostKnowledgeIndex } from './index/contract.js';
import { knowledgePacks } from './knowledgePacks.js';
import { repoGraphUnder, snapshotUnder } from './rootRelative.js';
import { serialisedByKey } from './serialisedByKey.js';
import { analyseWorkspace, type RepoGraphPort } from './workspaceAnalysis.js';
import { fingerprintSha } from './workspaceFingerprint.js';

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
    /** The host's knowledge index: fed the root's graph once the review is done (§4.3, last step), reported as the `index` phase. */
    index?: ReviewIndexPort;
    /** A linked host's platform graph of the root; null or a failure ⇒ the graph is built from the store. */
    platformGraph?(rootId: string): Promise<KnowledgeGraph | null>;
    /** A failed index update is reported, never a failed review. Must not throw (the runner calls it from its cleanup). */
    onIndexError?(error: unknown): void;
}

export interface KnowledgeReviewOptions {
    /** *Re-review all*: every file is planned as changed whatever the manifest holds (memory's `force`); judged sections whose text is unchanged are not judged again. */
    force?: boolean;
    /** The plan the person confirmed ({@link planKnowledgeReviewDetail}): reused without a re-walk (*Continue*, §4.3). */
    plan?: PlanDetail;
    /** Default {@link KNOWLEDGE_REVIEW_MODEL_CALLS}. */
    modelCalls?: number;
    signal?: AbortSignal;
    onProgress?(p: ReviewProgress): void;
}

/** The analyzers, recording which root-level outputs the last run produced (for {@link buildStoredGraph}). */
function recordingAnalyzers(inner: AnalyzerPort, manifest: IngestManifest): AnalyzerPort {
    return {
        async analyse(rootId, signal) {
            const out = await inner.analyse(rootId, signal);
            await manifest.set(analysisManifestKey(rootId), out.map((e) => ({ id: e.sourceRef, hash: e.sourceHash })));
            return out;
        },
    };
}

/** The ONE pack list, with this host's symbols, analyzers and layers. */
export function reviewPacks(ports: Pick<KnowledgeReviewPorts, 'symbolsOf' | 'analyzers' | 'partitions'>, manifest?: IngestManifest): KnowledgePack[] {
    const analyzers = ports.analyzers && manifest ? recordingAnalyzers(ports.analyzers, manifest) : ports.analyzers;
    return knowledgePacks({
        ...(ports.symbolsOf ? { symbolsOf: ports.symbolsOf } : {}),
        ...(analyzers ? { analyzers } : {}),
        ...(ports.partitions ? { partitions: ports.partitions } : {}),
    });
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
export function planKnowledgeReviewDetail(ports: KnowledgeReviewPorts, opts: Pick<KnowledgeReviewOptions, 'force'> = {}): Promise<PlanDetail> {
    return planDetail(ports.source, ports.manifest, reviewPacks(ports), { ...(opts.force ? { force: true } : {}), compare: willCompare(ports) });
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
    return serialisedByKey(ports.source.rootId, () => reviewOnce(ports, opts));
}

async function reviewOnce(ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions): Promise<ReviewReport> {
    // With an index to feed, `done` is memory's last word but not the run's: it waits for the `index` phase.
    const held: { done?: ReviewProgress } = {};
    const progress: KnowledgeReviewOptions['onProgress'] = ports.index && opts.onProgress
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
    const outcome: { report: ReviewReport } | { failure: { error: unknown } } = await reviewAndIndex(ports, opts, progress, tell).then(
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

async function reviewAndIndex(
    ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions, progress: KnowledgeReviewOptions['onProgress'],
    tell: (p: ReviewProgress) => void,
): Promise<ReviewReport> {
    const report = await reviewDirectory({
        source: ports.source,
        store: ports.store,
        packs: reviewPacks(ports, ports.manifest),
        manifest: ports.manifest,
        ...(ports.judgement ? { judgement: ports.judgement } : {}),
        ...(ports.similar ? { similar: ports.similar } : {}),
        ...(opts.plan ? { plan: opts.plan } : {}),
        ...(opts.force ? { force: true } : {}),
        budget: { modelCalls: opts.modelCalls ?? KNOWLEDGE_REVIEW_MODEL_CALLS, ms: Number.POSITIVE_INFINITY },
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(progress ? { onProgress: progress } : {}),
    });
    // What was edited since the last review is superseded by the files this one judged (or dropped).
    await pruneEditedFiles(ports.manifest, report.rootId);
    await indexReviewed(ports, report.rootId, tell);
    return report;
}

/**
 * After a review: the root's graph feeds the host's knowledge index. THE one place a host's
 * index is updated from a review, reported as the `index` phase between `write` and `done`
 * (`total` = the graph's nodes) so the view can say it is indexing. Only the graph build and the
 * upsert are index work (a failure there is `onIndexError`); `tell` is the progress emitter and never throws.
 */
async function indexReviewed(ports: KnowledgeReviewPorts, rootId: string, tell: (p: ReviewProgress) => void): Promise<void> {
    const index = ports.index;
    if (!index) return;
    let graph: KnowledgeGraph | null;
    try {
        graph = (await ports.platformGraph?.(rootId).catch(() => null))
            ?? await buildStoredGraph({ rootId, store: ports.store, manifest: ports.manifest, packs: reviewPacks(ports) });
    } catch (error) {
        ports.onIndexError?.(error);
        return;
    }
    if (!graph) return;
    const total = graph.nodes.length;
    tell({ phase: 'index', done: 0, total });
    try {
        await index.upsertFromGraph(graph);
    } catch (error) {
        ports.onIndexError?.(error);
        return;
    }
    tell({ phase: 'index', done: total, total });
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
}

/**
 * A root's graph built HERE, from what its reviews left in the store: each reviewed file's
 * extracted output (by the content hash the manifest holds, or the file's newer one once edited), the last analysis's root-level
 * output, and the stored facts and relations. Null when the root was never reviewed.
 */
export async function buildStoredGraph(args: StoredGraphArgs): Promise<KnowledgeGraph | null> {
    const { rootId, store, manifest } = args;
    // A file edited since its review is read at its NEW hash (`markFileEdited`), so its claims show stale.
    const files = [...(await currentFileHashes(manifest, rootId))].map(([id, hash]) => ({ id, hash }));
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
    const [facts, relations] = await Promise.all([store.facts({ rootId }), store.relations({ rootId })]);
    return buildGraph(
        {
            rootId, extracted, facts, relations, packs: args.packs,
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
 * A SYNC symbol lookup over a warm index's files (`WorkspaceSymbolIndex.filesUnder()`),
 * falling back to the regex extractor for a file the index has not seen. `prefix` maps a
 * reviewed sub-folder's paths onto the index's workspace-relative ones.
 */
export function indexedSymbolSource(files: ReadonlyArray<{ path: string; symbols: readonly CodeSymbol[] }>, prefix = ''): SymbolSource {
    const byPath = new Map(files.map((f) => [f.path.replace(/\\/g, '/'), f.symbols] as const));
    const base = prefix.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    return (path, content) => byPath.get(base ? `${base}/${path}` : path) ?? extractSymbols(path, content);
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
        async run(rootId, signal) {
            const { snapshot, repoGraph } = await analyseWorkspace(
                {
                    caps: deps.caps,
                    rootId,
                    ...(deps.onWarn ? { onWarn: deps.onWarn } : {}),
                    ...(deps.path ? { path: deps.path } : {}),
                    ...(deps.partitions ? { partitions: deps.partitions } : {}),
                    ...(deps.repoGraph ? { repoGraph: deps.repoGraph } : {}),
                },
                signal,
            );
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
