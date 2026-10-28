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
    buildGraph, DEFAULT_REVIEW_MODEL_CALLS, filesManifestKey, planReview, reviewDirectory, srcRef,
    type AnalyzerPort, type DirectorySource, type Extracted, type JudgementPort, type KnowledgeGraph,
    type KnowledgePack, type KnowledgeStore, type LiveOverlay, type NodeRef, type PartitionRegistry, type ReviewPlan,
    type ReviewProgress, type ReviewReport, type SimilarPair,
} from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import type { CapabilityProvider } from '../capabilities.js';
import type { CodeAnalysisSnapshot } from '../codeAnalysis.js';
import { extractSymbols, type CodeSymbol } from '../symbols.js';
import { codeAnalyzers, runCodeAnalysis } from './codeAnalyzers.js';
import type { SymbolSource } from './codePack.js';
import { knowledgePacks } from './knowledgePacks.js';

/** Judged sections per review before the chip asks again (PRD 38 §8.2). */
export const KNOWLEDGE_REVIEW_MODEL_CALLS = DEFAULT_REVIEW_MODEL_CALLS;

/** Manifest entry naming the root-level analyzer outputs of a root's last review. */
export const analysisManifestKey = (rootId: string): string => `knowledge:${rootId}:analysis`;

export interface KnowledgeReviewPorts {
    source: DirectorySource;
    store: KnowledgeStore;
    manifest: IngestManifest;
    judgement?: JudgementPort;
    /** Near-duplicate pairs from the knowledge index (claims to compare). */
    similar?(ids: string[]): Promise<SimilarPair[]>;
    /** Definitions per file from the host's warm symbol index. */
    symbolsOf?: SymbolSource;
    /** The code pack's analyzer run (see {@link workspaceCodeAnalyzers}). */
    analyzers?: AnalyzerPort;
    /** The code layers (`.builderforce/partitions.json` or the default). */
    partitions?: PartitionRegistry;
}

export interface KnowledgeReviewOptions {
    /** *Re-review all*: the manifest is ignored, so every file is planned as changed. */
    force?: boolean;
    /** Default {@link KNOWLEDGE_REVIEW_MODEL_CALLS}. */
    modelCalls?: number;
    signal?: AbortSignal;
    onProgress?(p: ReviewProgress): void;
}

/** *Re-review all*: reads see nothing (every file is changed), writes still persist. */
export function forcedManifest(inner: IngestManifest): IngestManifest {
    return {
        async get() { return undefined; },
        set: (sourceId, fingerprints) => inner.set(sourceId, fingerprints),
        delete: (sourceId) => inner.delete(sourceId),
    };
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

const manifestFor = (ports: KnowledgeReviewPorts, force?: boolean): IngestManifest =>
    (force ? forcedManifest(ports.manifest) : ports.manifest);

/** The confirm chip's numbers: a walk plus a manifest diff, no reads of unchanged files. */
export function planKnowledgeReview(ports: KnowledgeReviewPorts, opts: Pick<KnowledgeReviewOptions, 'force'> = {}): Promise<ReviewPlan> {
    return planReview(ports.source, manifestFor(ports, opts.force), reviewPacks(ports));
}

/** The review itself — only after the person confirmed the plan. */
export function runKnowledgeReview(ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions = {}): Promise<ReviewReport> {
    const manifest = manifestFor(ports, opts.force);
    return reviewDirectory({
        source: ports.source,
        store: ports.store,
        packs: reviewPacks(ports, manifest),
        manifest,
        ...(ports.judgement ? { judgement: ports.judgement } : {}),
        ...(ports.similar ? { similar: ports.similar } : {}),
        budget: { modelCalls: opts.modelCalls ?? KNOWLEDGE_REVIEW_MODEL_CALLS, ms: Number.POSITIVE_INFINITY },
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
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
 * extracted output (by the content hash the manifest holds), the last analysis's root-level
 * output, and the stored facts and relations. Null when the root was never reviewed.
 */
export async function buildStoredGraph(args: StoredGraphArgs): Promise<KnowledgeGraph | null> {
    const { rootId, store, manifest } = args;
    const files = (await manifest.get(filesManifestKey(rootId))) ?? [];
    const roots = (await manifest.get(analysisManifestKey(rootId))) ?? [];
    if (files.length === 0 && roots.length === 0) return null;
    const extracted: Extracted[] = [];
    const wanted = [
        ...files.map((f) => ({ ref: srcRef(rootId, f.id) as string, hash: f.hash })),
        ...roots.map((r) => ({ ref: r.id, hash: r.hash })),
    ];
    for (const w of wanted) {
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

/** The id a code-analysis snapshot is stored under (`PUT …/code-analysis/:sha`): its commit, else its own id. */
export function analysisSha(snapshot: CodeAnalysisSnapshot): string {
    return snapshot.source.commit ?? snapshot.id;
}

export interface WorkspaceAnalyzersDeps {
    /** The surface's capabilities — `shell` runs dependency-cruiser, jscpd and knip. */
    caps: CapabilityProvider;
    partitions?: PartitionRegistry;
    /** Workspace-relative folder to analyse (a reviewed sub-folder); absent ⇒ the whole tree. */
    path?: string;
    /** Linked hosts upload the snapshot (`client.putAnalysis`) so the web builds the same graph. */
    upload?(sha: string, snapshot: CodeAnalysisSnapshot): Promise<void>;
    /** A failed upload is reported, never a failed review. */
    onUploadError?(error: unknown): void;
}

/** The code pack's analyzers over this host's shell (the existing runner), uploading the snapshot when asked. */
export function workspaceCodeAnalyzers(deps: WorkspaceAnalyzersDeps): AnalyzerPort {
    return codeAnalyzers({
        async run(_rootId, signal) {
            const analysis = await runCodeAnalysis(
                { caps: deps.caps, ...(signal ? { signal } : {}) },
                { ...(deps.path ? { path: deps.path } : {}), ...(deps.partitions ? { partitions: deps.partitions } : {}) },
            );
            if (analysis && deps.upload) {
                await deps.upload(analysisSha(analysis), analysis).catch((error: unknown) => deps.onUploadError?.(error));
            }
            return { analysis };
        },
    });
}
