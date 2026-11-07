/**
 * knowledge/reviewJudgePass.ts — pass 2 of a two-pass review (PRD 41 A10): the map is complete (pass 1 ended
 * `mapped`, the index is fed), so the files still owed model judgement are judged here, in the SAME run.
 *
 *   order    entry points and manifests, then files with the most inbound references, then recently changed
 *            files, then the rest (memory's `orderForJudging`, pure and deterministic);
 *   budget   the first `judgeFiles` of that order; the others stay owed for the next run;
 *   apply    one memory `reviewDirectory` call restricted to those files (`only`), judging ON. Its ordered
 *            writer applies them in plan order, so the stored bytes equal a sequential run's with the same budget;
 *   report   pass 1's report plus pass 2's: `awaitingJudge` is what is still owed ("N files waiting to be judged").
 *
 * Only `judge` progress and steps are forwarded: pass 2 re-reads its files from the extract cache, and that
 * must not look like a second extraction in the Run panel.
 */

import {
    orderForJudging, pathOfRef, refreshPlan, reviewDirectory,
    type JudgeSignals, type KnowledgeGraph, type PlanDetail, type ReviewArgs, type ReviewProgress, type ReviewReport, type ReviewStep,
} from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeReviewOptions, KnowledgeReviewPorts } from './reviewRunner.js';

/** Manifest-like files that open a folder: judged first. */
const ENTRY_NAMES: ReadonlySet<string> = new Set([
    'readme.md', 'agents.md', 'claude.md', 'contributing.md', 'architecture.md', 'index.md', 'package.json', 'cargo.toml', 'pyproject.toml', 'go.mod',
]);

/** The signals pass 2 orders by: entry badges and manifest names, inbound references from the mapped graph, files changed since the last review. */
export function judgeSignalsOf(
    graph: KnowledgeGraph | null, rootId: string, plan: PlanDetail | undefined,
): JudgeSignals {
    const entryPaths = new Set<string>();
    const inbound = new Map<string, number>();
    if (graph) {
        for (const n of graph.nodes) {
            if (!n.badges?.entry) continue;
            const path = pathOfRef(n.ref);
            if (path !== undefined) entryPaths.add(path);
        }
        for (const e of graph.edges) {
            if (e.kind !== 'references' && e.kind !== 'links') continue;
            const from = pathOfRef(e.from), to = pathOfRef(e.to);
            if (to === undefined || to === from) continue;
            inbound.set(to, (inbound.get(to) ?? 0) + 1);
        }
    }
    const recent = new Set<string>();
    if (plan) for (const f of plan.files) { const prior = plan.prior.get(f.path); if (prior !== undefined && prior !== f.hash) recent.add(f.path); }
    const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    return { entry: (p) => entryPaths.has(p) || ENTRY_NAMES.has(base(p)), inbound, recent };
}

export interface JudgePassDeps {
    ports: KnowledgeReviewPorts;
    opts: KnowledgeReviewOptions;
    /** Pass 1's report (`awaitingJudge` = the files to judge). */
    mapped: ReviewReport;
    /** The mapped graph pass 1's index step built; null when there is no index port. */
    graph: KnowledgeGraph | null;
    tell(p: ReviewProgress): void;
    /** A fresh plan, for a run that was not handed a confirmed one. */
    freshPlan(): Promise<PlanDetail>;
    directoryArgs(
        ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions, progress: KnowledgeReviewOptions['onProgress'],
        extra?: Pick<ReviewArgs, 'mechanical' | 'only'>,
    ): ReviewArgs;
    indexReviewed(ports: KnowledgeReviewPorts, rootId: string, tell: (p: ReviewProgress) => void): Promise<KnowledgeGraph | null>;
}

/** Merges pass 2's report into pass 1's: counters add, what is still owed is the rest of pass 1's list plus pass 2's own. */
export function mergeReports(mapped: ReviewReport, judged: ReviewReport, took: ReadonlySet<string>): ReviewReport {
    const owed = [...mapped.awaitingJudge.filter((p) => !took.has(p)), ...judged.awaitingJudge];
    return {
        ...judged,
        extracted: mapped.extracted,
        readErrors: mapped.readErrors,
        extractErrors: mapped.extractErrors,
        failures: [...mapped.failures, ...judged.failures],
        factsWritten: mapped.factsWritten + judged.factsWritten,
        relationsWritten: mapped.relationsWritten + judged.relationsWritten,
        staleMarked: mapped.staleMarked + judged.staleMarked,
        awaitingJudge: owed,
        awaitingJudgeCount: owed.length,
        durationMs: mapped.durationMs + judged.durationMs,
    };
}

export async function runJudgePass(d: JudgePassDeps): Promise<ReviewReport> {
    const { ports, opts, mapped } = d;
    const budget = Math.max(0, Math.floor(opts.judgeFiles ?? 0));
    if (budget === 0 || mapped.awaitingJudge.length === 0 || opts.signal?.aborted) return mapped;

    const plan = opts.plan ? await refreshPlan(opts.plan, ports.manifest) : await d.freshPlan();
    const ordered = orderForJudging(mapped.awaitingJudge, judgeSignalsOf(d.graph, mapped.rootId, opts.plan ?? plan));
    const only = ordered.slice(0, budget);
    const took = new Set(only);
    d.tell({ phase: 'judge', done: 0, total: only.length });
    // Only judge progress and steps are the run's: the cached re-extraction of these files is not a second extraction.
    const forward: KnowledgeReviewOptions['onProgress'] = (p) => {
        if (p.phase === 'judge') d.tell({ ...p, done: Math.min(p.done, only.length - 1), total: only.length });
    };
    const judgeOpts: KnowledgeReviewOptions = {
        ...opts, plan,
        ...(opts.onStep ? { onStep: (s: ReviewStep) => { if (s.phase === 'judge') opts.onStep!(s); } } : {}),
    };
    const judged = await reviewDirectory(
        d.directoryArgs(ports, judgeOpts, forward, { only }),
    );
    d.tell({ phase: 'judge', done: only.length, total: only.length });
    await d.indexReviewed(ports, mapped.rootId, d.tell); // each judged file is now in the map
    return mergeReports(mapped, judged, took);
}
