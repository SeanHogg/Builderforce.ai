/**
 * What the "Now" card reads from a run, pure: its steps (count, start the workers, read and save, judge, update the map)
 * with the numbers each one has, and the few lines of "where the time goes". Every value is in the run record; a value the
 * record lacks is absent here, and the card shows nothing for it.
 */

import type { StoredReviewRun } from '../../types';
import { extractProgress, type ExtractProgress } from './runPace';
import { reasonKind, slowestOf } from './runModel';

export type StepState = 'done' | 'active' | 'pending';

export interface NowSteps {
    count: { state: StepState; files?: number; ms?: number };
    /** The gap between the plan phase ending and the extract phase starting. */
    workers: { state: StepState; ms?: number };
    read: { state: StepState; progress?: ExtractProgress };
    /** Absent when the record names no judge budget. */
    judge?: { state: StepState; count: number; done: number; total: number };
    update: { state: StepState };
}

export interface TimeLines {
    /** Files that failed by timing out, and the longest time a timed-out step ran (the limit it hit), when the ring holds one. */
    timeouts?: { count: number; limitMs?: number };
    /** The longest a slow step waited for a free worker (ms). */
    waitMs?: number;
    /** The longest the host's event loop stalled (ms). */
    stallMs?: number;
}

const phaseOf = (run: StoredReviewRun, phase: StoredReviewRun['phases'][number]['phase']) => run.phases.find((p) => p.phase === phase);

export function nowSteps(run: StoredReviewRun, judgeBudget?: number): NowSteps {
    const plan = phaseOf(run, 'plan');
    const extract = phaseOf(run, 'extract');
    const judge = phaseOf(run, 'judge');
    const ended = run.endedAt !== undefined;
    const stateOf = (p: { endedAt?: number | undefined } | undefined): StepState => (!p ? 'pending' : p.endedAt !== undefined || ended ? 'done' : 'active');
    const gap = plan?.endedAt !== undefined && extract ? extract.startedAt - plan.endedAt : undefined;
    const count = extract?.total;
    const budget = judge?.total ?? judgeBudget ?? run.awaitingJudgeTotal;
    const later = ['write', 'index', 'mapped'].some((n) => run.phases.some((p) => p.phase === n));
    return {
        count: {
            state: stateOf(plan), ...(count !== undefined ? { files: count } : {}),
            ...(plan?.endedAt !== undefined ? { ms: plan.endedAt - plan.startedAt } : {}),
        },
        workers: { state: extract ? 'done' : plan ? 'active' : 'pending', ...(gap !== undefined && gap >= 0 ? { ms: gap } : {}) },
        read: { state: stateOf(extract), ...((): { progress?: ExtractProgress } => { const p = extractProgress(run); return p ? { progress: p } : {}; })() },
        ...(budget !== undefined && budget > 0
            ? { judge: { state: stateOf(judge), count: budget, done: judge?.done ?? 0, total: judge?.total ?? budget } }
            : {}),
        update: { state: ended ? 'done' : later ? 'active' : 'pending' },
    };
}

export function timeLines(run: StoredReviewRun): TimeLines {
    const timedOut = run.failures.filter((f) => reasonKind(f.reason) === 'timeout').length;
    const limit = Math.max(0, ...run.steps.filter((s) => s.outcome === 'failed' && s.reason !== undefined && reasonKind(s.reason) === 'timeout').map((s) => s.ms));
    const wait = Math.max(0, ...slowestOf(run).map((s) => s.parts?.poolMs ?? 0));
    const stall = run.hostLag?.maxMs ?? 0;
    return {
        ...(timedOut > 0 ? { timeouts: { count: timedOut, ...(limit > 0 ? { limitMs: limit } : {}) } } : {}),
        ...(wait > 0 ? { waitMs: wait } : {}),
        ...(stall > 0 ? { stallMs: stall } : {}),
    };
}
