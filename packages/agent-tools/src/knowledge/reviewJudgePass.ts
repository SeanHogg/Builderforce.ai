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
import type { RunHandoff } from './reviewRunLock.js';

/** Manifest-like files that open a folder: judged first. */
const ENTRY_NAMES: ReadonlySet<string> = new Set([
    'readme.md', 'agents.md', 'claude.md', 'contributing.md', 'architecture.md', 'index.md', 'package.json', 'cargo.toml', 'pyproject.toml', 'go.mod',
]);

/** The signals pass 2 orders by: entry badges and manifest names, inbound references from the mapped graph, files changed since the last review. */
export function judgeSignalsOf(
    graph: KnowledgeGraph | null, plan: PlanDetail | undefined,
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
    /** Gives the root's lock back before judging; a new review of the root stops this pass. */
    handoff: RunHandoff;
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
    const judgedFiles = (mapped.judgedFiles ?? 0) + (judged.judgedFiles ?? 0);
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
        judged: mapped.judged + judged.judged,
        unjudged: mapped.unjudged + judged.unjudged,
        invalidJudgements: mapped.invalidJudgements + judged.invalidJudgements,
        awaitingJudge: owed,
        awaitingJudgeCount: owed.length,
        ...(judged.judgeStopped ? { judgeStopped: judged.judgeStopped } : mapped.judgeStopped ? { judgeStopped: mapped.judgeStopped } : {}),
        judgedFiles,
        durationMs: mapped.durationMs + judged.durationMs,
    };
}

/** Files judged between two index updates: the map follows the judging in steps, not only at its end. */
export const JUDGE_INDEX_EVERY = 100;

export async function runJudgePass(d: JudgePassDeps): Promise<ReviewReport> {
    const { mapped } = d;
    const budget = Math.max(0, Math.floor(d.opts.judgeFiles ?? 0));
    if (budget === 0 || mapped.awaitingJudge.length === 0 || d.opts.signal?.aborted) return mapped;

    // Background work: the root's lock goes back now, and a new review of the root stops this pass (its unjudged files stay owed).
    const stop = new AbortController();
    const relay = (): void => stop.abort();
    d.opts.signal?.addEventListener('abort', relay, { once: true });
    d.handoff.judging(relay);
    d.handoff.release();
    const opts: KnowledgeReviewOptions = { ...d.opts, signal: stop.signal };
    try {
        return await judgeAll(d, opts, budget);
    } finally {
        d.opts.signal?.removeEventListener('abort', relay);
    }
}

async function judgeAll(d: JudgePassDeps, opts: KnowledgeReviewOptions, budget: number): Promise<ReviewReport> {
    const { ports, mapped } = d;

    // `opts.plan` is the plan pass 1 ran on: its manifest hashes are the LAST review's, which is what "recently changed" compares against.
    const plan = opts.plan ? await refreshPlan(opts.plan, ports.manifest) : await d.freshPlan();
    const ordered = orderForJudging(mapped.awaitingJudge, judgeSignalsOf(d.graph, opts.plan ?? plan));
    const only = ordered.slice(0, budget);
    // Judging alone: no analyzers, no coverage / history / owner reads (the map pass did them), only the parsers.
    const { analyzers: _analyzers, history: _history, rootFiles: _rootFiles, ...judgingPorts } = ports;
    let report = mapped;
    for (let at = 0; at < only.length; at += JUDGE_INDEX_EVERY) {
        const slice = only.slice(at, at + JUDGE_INDEX_EVERY);
        // Only judge progress and steps are the run's: the cached re-extraction of these files is not a second extraction.
        // The phase's `done` is the index of the file reached (the run reducer adds one), across slices.
        const forward: KnowledgeReviewOptions['onProgress'] = (p) => {
            if (p.phase === 'judge') d.tell({ ...p, done: at + p.done, total: only.length });
        };
        const judgeOpts: KnowledgeReviewOptions = {
            ...opts, plan,
            ...(opts.onStep ? { onStep: (s: ReviewStep) => { if (s.phase === 'judge') opts.onStep!(s); } } : {}),
        };
        const judged = await reviewDirectory(d.directoryArgs(judgingPorts, judgeOpts, forward, { only: slice }));
        report = mergeReports(report, judged, new Set(slice));
        await d.indexReviewed(ports, mapped.rootId, d.tell); // each judged file is now in the map
        if (judged.aborted || judged.judgeStopped) break;
    }
    if (!report.aborted && !report.judgeStopped) d.tell({ phase: 'judge', done: only.length - 1, total: only.length });
    return report;
}
