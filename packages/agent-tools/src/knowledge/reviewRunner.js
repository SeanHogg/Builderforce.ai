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
import { DEFAULT_REVIEW_MODEL_CALLS, planDetail, reviewDirectory, srcRef, } from '@seanhogg/builderforce-memory/knowledge';
import { isCodePath } from './codePack.js';
import { readEntryPaths } from './codeEntryPoints.js';
import { buildCodeGraph } from './codeGraph.js';
import { listedModuleResolution } from './codeRollup.js';
import { loadModuleAliases } from './moduleAliasLoader.js';
import { withRootSignals } from './codeRootSignals.js';
import { currentFileHashes, pruneEditedFiles } from './fileEdits.js';
import { knowledgePacks } from './knowledgePacks.js';
import { noteGraphReads } from './graphReads.js';
import { runPreemptingJudge } from './reviewRunLock.js';
import { readSystems, recordSystems } from './systemsRecord.js';
import { analyseWorkspaceExtracted } from './workspaceExtracted.js';
import { fingerprintSha } from './workspaceFingerprint.js';
import { runJudgePass } from './reviewJudgePass.js';
import { directoryArgs } from './reviewDirectoryArgs.js';
import { isLandingManifest, landingManifest } from './landingManifest.js';
/** Judged sections per review before the chip asks again (PRD 38 §8.2). */
export const KNOWLEDGE_REVIEW_MODEL_CALLS = DEFAULT_REVIEW_MODEL_CALLS;
/** Manifest entry naming the root-level analyzer outputs of a root's last review. */
export const analysisManifestKey = (rootId) => `knowledge:${rootId}:analysis`;
/** The review's index port over a host's (lazily opened) knowledge index — ONE adapter for every host. */
export function reviewIndexPort(index) {
    return {
        upsertFromGraph: async (graph) => (await index()).upsertFromGraph(graph),
        discardProvisional: async () => (await index()).discardProvisional(),
    };
}
/** The analyzers, recording which root-level outputs the last run produced (for {@link buildStoredGraph}). */
function recordingAnalyzers(inner, manifest) {
    return {
        async analyse(rootId, signal) {
            const out = await inner.analyse(rootId, signal);
            const entries = out.map((e) => ({ id: e.sourceRef, hash: e.sourceHash }));
            // The review stores these outputs AFTER this returns: the entry lands with or after them, never ahead (landingManifest.ts).
            if (isLandingManifest(manifest))
                manifest.hold(analysisManifestKey(rootId), entries);
            else
                await manifest.set(analysisManifestKey(rootId), entries);
            return out;
        },
    };
}
/** The files a review saw: its confirmed plan's (no second walk), else one listing of the source. Manifests the plan skipped as `no-pack` are included (entry points come from them). */
function reviewedPaths(source, plan) {
    return async () => {
        if (plan)
            return [...plan.files.map((f) => f.path), ...plan.plan.skipped.map((f) => f.path)];
        const paths = [];
        if (source)
            for await (const f of source.list())
                paths.push(f.path);
        return paths;
    };
}
/** The ONE pack list, with this host's symbols, analyzers and layers. */
export function reviewPacks(ports, manifest, 
/** The review's confirmed plan: the files the signals are read for (default: one listing of the source). */
plan) {
    // Coverage, churn and owners are read once per review, alongside the analyzers (only a running review has a manifest to record them in).
    const source = ports.source;
    const signals = {
        ...(ports.history ? { history: ports.history } : {}),
        ...(ports.rootFiles ? { files: ports.rootFiles } : {}),
        ...(source ? { entryPaths: (candidates) => readEntryPaths(source, candidates) } : {}),
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
export async function rootModuleResolution(source, plan) {
    const paths = await reviewedPaths(source, plan)();
    const listed = new Set(paths);
    const read = async (path) => {
        const doc = await source.read(path);
        return doc.content.kind === 'text' ? doc.content.text : undefined;
    };
    return listedModuleResolution(await loadModuleAliases(paths.filter(isCodePath), read, { listed }), listed);
}
/**
 * The run's extract pool with the root's aliases on every job: a worker builds its own packs, so it gets the aliases as
 * data (`aliases`) and answers module existence itself.
 */
function poolWithAliases(pool, modules) {
    if (!pool || modules.aliases.scopes.length === 0)
        return pool;
    return (job, signal) => pool(Object.assign({}, job, { aliases: modules.aliases }), signal);
}
/**
 * Whether a run on these ports compares near-duplicate claims — memory's rule: it needs both a
 * judgement port and `similar`. The plan counts compare calls only then, so the confirm chip
 * never states calls the run will not spend (a host without `similar`, like the browser's, plans none).
 */
function willCompare(ports) {
    return !!ports.judgement && !!ports.similar;
}
/** The confirm chip's numbers AND the walk behind them: hand it back as `plan` to run the review without re-walking. */
export function planKnowledgeReviewDetail(ports, 
/** `compare` overrides the ports-derived answer: a host that knows a judge will be there, but has not started it, counts the compare calls. */
opts = {}) {
    return planDetail(ports.source, ports.manifest, reviewPacks(ports), { ...(opts.force ? { force: true } : {}), compare: opts.compare ?? willCompare(ports) });
}
/** The confirm chip's numbers: a walk plus a manifest diff, no reads of unchanged files. */
export async function planKnowledgeReview(ports, opts = {}) {
    return (await planKnowledgeReviewDetail(ports, opts)).plan;
}
/**
 * The review itself — only after the person confirmed the plan. Reviews of one root run one
 * at a time (a later run waits for the earlier one): a run's provisional-card cleanup and graph
 * upsert would otherwise drop the cards of another run still in flight on the same root's index.
 * A run queued behind another for the same root sees its abort signal only once it starts.
 */
export function runKnowledgeReview(ports, opts = {}) {
    return runPreemptingJudge(ports.source.rootId, (handoff) => reviewOnce(ports, opts, handoff));
}
async function reviewOnce(ports, opts, handoff) {
    // With an index to feed, `done` is memory's last word but not the run's: it waits for the `index` phase.
    const held = {};
    const progress = (ports.index || opts.judgeFiles !== undefined) && opts.onProgress
        ? (p) => { if (p.phase === 'done')
            held.done = p;
        else
            opts.onProgress(p); }
        : opts.onProgress;
    // The listener's failure on a phase the runner emits itself (`index`, the held `done`) must not change what the run does: it waits for the end.
    const listener = {};
    const tell = (p) => {
        try {
            opts.onProgress?.(p);
        }
        catch (error) {
            listener.failure ??= { error };
        }
    };
    const outcome = await reviewAndIndex(ports, opts, progress, tell, handoff).then((report) => ({ report }), (error) => ({ failure: { error } }));
    // However the run ended: no unwritten claim stays in the index, and the held `done` is forwarded once, last.
    // `Promise.resolve().then` also catches a port that throws before it returns its promise.
    await Promise.resolve().then(() => ports.index?.discardProvisional()).catch((error) => ports.onIndexError?.(error));
    if (held.done)
        tell(held.done);
    // The review's own error wins over the listener's; a listener that throws after a clean run is the caller's to see.
    if ('failure' in outcome)
        throw outcome.failure.error;
    if (listener.failure)
        throw listener.failure.error;
    return outcome.report;
}
const directoryArgsOf = (ports, opts, progress, extra = {}) => {
    // One run, one landing manifest: what the analyzers produced is recorded only once the review has stored it.
    const manifest = landingManifest(ports.manifest);
    return directoryArgs({ ...ports, manifest }, opts, reviewPacks(ports, manifest, opts.plan), progress, KNOWLEDGE_REVIEW_MODEL_CALLS, extra);
};
async function reviewAndIndex(ports, opts, progress, tell, handoff) {
    const twoPass = opts.judgeFiles !== undefined && !!ports.judgement;
    // Two passes share ONE plan: its manifest hashes are the last review's (what pass 2's "recent" compares against), and neither pass walks again.
    const plan = opts.plan ?? (twoPass ? await planKnowledgeReviewDetail(ports, opts.force ? { force: true } : {}) : undefined);
    // The root's aliases, once per run: every extract of it (in-thread or pooled, both passes) resolves with the same ones.
    const modules = ports.modules ?? await rootModuleResolution(ports.source, plan);
    ports = { ...ports, modules };
    const pool = poolWithAliases(opts.extractPool, modules);
    const passOpts = { ...opts, ...(plan ? { plan } : {}), ...(pool ? { extractPool: pool } : {}) };
    const report = await reviewDirectory(directoryArgsOf(ports, passOpts, progress, twoPass ? { mechanical: true } : {}));
    // What was edited since the last review is superseded by the files this one judged (or dropped).
    await pruneEditedFiles(ports.manifest, report.rootId);
    // The root's systems (PRD 41 A9): detected from what this review saw, kept with it for the graph build.
    if (!report.aborted) {
        await recordSystems({
            rootId: report.rootId, rootName: ports.source.title, source: ports.source, manifest: ports.manifest,
            ...(opts.plan ? { plan: opts.plan } : {}),
        }).catch((error) => ports.onSystemsError?.(error));
    }
    const graph = await indexReviewed(ports, report.rootId, tell);
    if (!twoPass || report.aborted)
        return report;
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
async function indexReviewed(ports, rootId, tell) {
    const index = ports.index;
    if (!index)
        return null;
    let graph;
    try {
        graph = (await ports.platformGraph?.(rootId).catch(() => null))
            ?? await buildStoredGraph({ rootId, store: ports.store, manifest: ports.manifest, packs: reviewPacks(ports) });
    }
    catch (error) {
        ports.onIndexError?.(error);
        return null;
    }
    if (!graph)
        return null;
    const total = graph.nodes.length;
    tell({ phase: 'index', done: 0, total });
    try {
        await index.upsertFromGraph(graph);
    }
    catch (error) {
        ports.onIndexError?.(error);
        return graph;
    }
    tell({ phase: 'index', done: total, total });
    return graph;
}
/** The content hash of every file a stored graph reads: the review's (or a newer edit's), with `overrides` applied. */
export async function storedFileHashes(manifest, rootId, overrides) {
    const hashes = await currentFileHashes(manifest, rootId);
    for (const [path, hash] of overrides ?? []) {
        if (hash === null)
            hashes.delete(path);
        else
            hashes.set(path, hash);
    }
    return hashes;
}
/**
 * A root's graph built HERE, from what its reviews left in the store: each reviewed file's
 * extracted output (by the content hash the manifest holds, or the file's newer one once edited), the last analysis's root-level
 * output, and the stored facts and relations. Null when the root was never reviewed.
 */
export async function buildStoredGraph(args) {
    const { rootId, store, manifest } = args;
    // A file edited since its review is read at its NEW hash (`markFileEdited`), so its claims show stale.
    const files = [...(await storedFileHashes(manifest, rootId, args.hashOverrides))].map(([id, hash]) => ({ id, hash }));
    const roots = (await manifest.get(analysisManifestKey(rootId))) ?? [];
    if (files.length === 0 && roots.length === 0)
        return null;
    const extracted = [];
    const wanted = [
        ...files.map((f) => ({ ref: srcRef(rootId, f.id), hash: f.hash })),
        ...roots.map((r) => ({ ref: r.id, hash: r.hash })),
    ];
    // A UI-thread host yields the loop every so often: each per-file read resolves
    // synchronously, so without a macrotask the whole walk blocks pending bridge work.
    const yieldEvery = args.yieldEvery ?? 0;
    let sinceYield = 0;
    for (const w of wanted) {
        // A deleted file has no content hash: there is nothing of it to fetch.
        if (!w.hash)
            continue;
        const hit = (await store.getExtracted?.(w.hash))?.find((e) => e.sourceRef === w.ref);
        if (hit)
            extracted.push(hit);
        if (yieldEvery > 0 && args.yieldDelay && ++sinceYield >= yieldEvery) {
            sinceYield = 0;
            await args.yieldDelay();
        }
    }
    const [facts, relations, systems] = await Promise.all([store.facts({ rootId }), store.relations({ rootId }), readSystems(manifest, rootId)]);
    // The ONE graph builder for code: the default layers are resolved over the whole file graph (folder, name, import direction).
    return buildCodeGraph({
        rootId, extracted, facts, relations, packs: args.packs,
        ...(systems.length > 0 ? { systems } : {}),
        ...(args.live ? { live: args.live } : {}),
        ...(args.nearDuplicates ? { nearDuplicates: args.nearDuplicates } : {}),
    }, {
        ...(args.maxNodes ? { maxNodes: args.maxNodes } : {}),
        ...(args.focus?.length ? { focus: args.focus } : {}),
        ...(args.findings ? { findings: args.findings } : {}),
    });
}
/**
 * The id a code-analysis snapshot is stored under (`PUT …/code-analysis/:sha`): its commit,
 * plus a digest of the uncommitted state when the tree was dirty — so two dirty snapshots of
 * one commit do not overwrite each other — else its own id.
 */
export function analysisSha(snapshot) {
    return fingerprintSha(snapshot.source) ?? snapshot.id;
}
/** The code pack's analyzers over this host's shell and repo map (cached per sha), uploading the snapshot when asked. */
export function workspaceCodeAnalyzers(deps) {
    // Where the analysis runs is the host's: its runner (a worker), else this thread.
    const run = deps.runner ?? ((rootId, { signal, onProgress, onWarn }) => analyseWorkspaceExtracted({
        caps: deps.caps,
        rootId,
        ...(onWarn ? { onWarn } : {}),
        ...(deps.path ? { path: deps.path } : {}),
        ...(deps.partitions ? { partitions: deps.partitions } : {}),
        ...(deps.repoGraph ? { repoGraph: deps.repoGraph } : {}),
        ...(onProgress ? { onProgress } : {}),
        ...(deps.l3 ? { l3: deps.l3 } : {}),
    }, signal));
    return {
        async analyse(rootId, signal, onProgress) {
            const done = await run(rootId, { ...(signal ? { signal } : {}), ...(onProgress ? { onProgress } : {}), ...(deps.onWarn ? { onWarn: deps.onWarn } : {}) });
            // What the repo graph read of each system goes to the systems record the review writes (see `recordSystems`).
            noteGraphReads(rootId, done.graphReads);
            // The snapshot is relative to the root (its manifest, its refs, the platform's graph of it) — the upload too.
            if (done.snapshot && deps.upload) {
                await deps.upload(analysisSha(done.snapshot), done.snapshot).catch((error) => deps.onUploadError?.(error));
            }
            return done.extracted;
        },
    };
}
//# sourceMappingURL=reviewRunner.js.map