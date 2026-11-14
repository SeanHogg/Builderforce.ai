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
import { orderForJudging, pathOfRef, refreshPlan, reviewDirectory, } from '@seanhogg/builderforce-memory/knowledge';
/** Manifest-like files that open a folder: judged first. */
const ENTRY_NAMES = new Set([
    'readme.md', 'agents.md', 'claude.md', 'contributing.md', 'architecture.md', 'index.md', 'package.json', 'cargo.toml', 'pyproject.toml', 'go.mod',
]);
/** The signals pass 2 orders by: entry badges and manifest names, inbound references from the mapped graph, files changed since the last review. */
export function judgeSignalsOf(graph, plan) {
    const entryPaths = new Set();
    const inbound = new Map();
    if (graph) {
        for (const n of graph.nodes) {
            if (!n.badges?.entry)
                continue;
            const path = pathOfRef(n.ref);
            if (path !== undefined)
                entryPaths.add(path);
        }
        for (const e of graph.edges) {
            if (e.kind !== 'references' && e.kind !== 'links')
                continue;
            const from = pathOfRef(e.from), to = pathOfRef(e.to);
            if (to === undefined || to === from)
                continue;
            inbound.set(to, (inbound.get(to) ?? 0) + 1);
        }
    }
    const recent = new Set();
    if (plan)
        for (const f of plan.files) {
            const prior = plan.prior.get(f.path);
            if (prior !== undefined && prior !== f.hash)
                recent.add(f.path);
        }
    const base = (p) => p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    return { entry: (p) => entryPaths.has(p) || ENTRY_NAMES.has(base(p)), inbound, recent };
}
/** Merges pass 2's report into pass 1's: counters add, what is still owed is the rest of pass 1's list plus pass 2's own. */
export function mergeReports(mapped, judged, took) {
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
export async function runJudgePass(d) {
    const { mapped } = d;
    const budget = Math.max(0, Math.floor(d.opts.judgeFiles ?? 0));
    if (budget === 0 || mapped.awaitingJudge.length === 0 || d.opts.signal?.aborted)
        return mapped;
    // Background work: the root's lock goes back now, and a new review of the root stops this pass (its unjudged files stay owed).
    const stop = new AbortController();
    const relay = () => stop.abort();
    d.opts.signal?.addEventListener('abort', relay, { once: true });
    d.handoff.judging(relay);
    d.handoff.release();
    const opts = { ...d.opts, signal: stop.signal };
    try {
        return await judgeAll(d, opts, budget);
    }
    finally {
        d.opts.signal?.removeEventListener('abort', relay);
    }
}
async function judgeAll(d, opts, budget) {
    const { ports, mapped } = d;
    // `opts.plan` is the plan pass 1 ran on: its manifest hashes are the LAST review's, which is what "recently changed" compares against.
    const plan = opts.plan ? await refreshPlan(opts.plan, ports.manifest) : await d.freshPlan();
    const ordered = orderForJudging(mapped.awaitingJudge, judgeSignalsOf(d.graph, opts.plan ?? plan));
    const only = ordered.slice(0, budget);
    // Judging alone: no analyzers, no coverage / history / owner reads (the map pass did them), only the parsers.
    const { analyzers: _analyzers, history: _history, rootFiles: _rootFiles, ...judgingPorts } = ports;
    // Judging measures nothing new: each slice's finish restates what the map pass recorded (PRD 41 §C9), never "no analyzers".
    const recorded = (await ports.store.scopes()).find((s) => s.rootId === mapped.rootId)?.measured;
    let report = mapped;
    for (let at = 0; at < only.length; at += JUDGE_INDEX_EVERY) {
        const slice = only.slice(at, at + JUDGE_INDEX_EVERY);
        // Only judge progress and steps are the run's: the cached re-extraction of these files is not a second extraction.
        // The phase's `done` is the index of the file reached (the run reducer adds one), across slices.
        const forward = (p) => {
            if (p.phase === 'judge')
                d.tell({ ...p, done: at + p.done, total: only.length });
        };
        const judgeOpts = {
            ...opts, plan,
            ...(opts.onStep ? { onStep: (s) => { if (s.phase === 'judge')
                    opts.onStep(s); } } : {}),
        };
        const args = d.directoryArgs(judgingPorts, judgeOpts, forward, { only: slice });
        const judged = await reviewDirectory(recorded ? { ...args, measured: recorded } : args);
        report = mergeReports(report, judged, new Set(slice));
        await d.indexReviewed(ports, mapped.rootId, d.tell); // each judged file is now in the map
        if (judged.aborted || judged.judgeStopped)
            break;
    }
    if (!report.aborted && !report.judgeStopped)
        d.tell({ phase: 'judge', done: only.length - 1, total: only.length });
    return report;
}
//# sourceMappingURL=reviewJudgePass.js.map