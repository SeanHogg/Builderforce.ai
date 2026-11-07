/**
 * The Run panel's readings of a review run (PRD 41 A8), pure: the phase rows with their rate and ETA
 * (memory's `runRate` / `runEta`: the host and the view can never disagree), the lanes of the current
 * phase, the step feed and its filter, and a failure's short reason. React-free and clock-free.
 */

import { runEta, runRate, slowestSteps, type ReviewPhase, type ReviewRun, type ReviewStep } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { StoredReviewRun } from '../../types';

/** The order a review moves through its phases: pass 1 (mechanical) ends at the `mapped` milestone, then pass 2 judges (PRD 41 A10). */
export const RUN_PHASE_ORDER: readonly ReviewPhase[] = ['plan', 'extract', 'resolve', 'compare', 'write', 'index', 'mapped', 'judge', 'done'];

export type PhaseState = 'done' | 'active' | 'pending';

export interface PhaseRow {
    phase: ReviewPhase;
    done: number;
    total: number;
    /** 0 to 1. */
    frac: number;
    state: PhaseState;
    /** Items per second so far; 0 when none yet. */
    rate: number;
    /** Milliseconds left at that rate; undefined when it cannot be told. */
    etaMs: number | undefined;
    /** A milestone (`mapped`: the map is complete) has no progress, rate or ETA of its own. */
    milestone: boolean;
}

/** The phases the run has reached, in order, each with its progress, rate and ETA; the first unfinished one is the active one (none, once the run ended). */
export function phaseRows(run: StoredReviewRun): PhaseRow[] {
    const reached = [...run.phases].sort((a, b) => RUN_PHASE_ORDER.indexOf(a.phase) - RUN_PHASE_ORDER.indexOf(b.phase));
    const live = run.endedAt === undefined;
    const active = live ? reached.find((p) => p.endedAt === undefined)?.phase : undefined;
    return reached.map((p) => {
        const finished = p.endedAt !== undefined;
        if (p.phase === 'mapped') {
            // Reaching the milestone is the event: it is done as soon as it appears, whatever `endedAt` says.
            return { phase: p.phase, done: p.done, total: p.total, frac: 1, state: 'done', rate: 0, etaMs: 0, milestone: true };
        }
        return {
            milestone: false,
            phase: p.phase,
            done: p.done,
            total: p.total,
            frac: p.total > 0 ? Math.min(1, p.done / p.total) : finished ? 1 : 0,
            state: finished ? 'done' : p.phase === active ? 'active' : 'pending',
            rate: runRate(run as ReviewRun, p.phase),
            etaMs: finished ? 0 : runEta(run as ReviewRun, p.phase),
        };
    });
}

/**
 * How many files still wait for model judging (PRD 41 A10): the report's `awaitingJudgeCount` once it exists (a count only: the path list never leaves memory), else, while the run
 * is judging after the map is complete, the owed total the host recorded at `mapped` (`awaitingJudgeTotal`) minus the judge phase's done. The judge phase's own total is the
 * budget pass 2 took, not what is owed, so it is the fallback only when the host sent no owed total. 0 when nothing waits.
 */
export function awaitingJudgeCount(run: StoredReviewRun): number {
    const owed = run.report?.awaitingJudgeCount ?? 0;
    if (owed > 0) return owed;
    if (run.endedAt !== undefined || !run.phases.some((p) => p.phase === 'mapped')) return 0;
    const judge = run.phases.find((p) => p.phase === 'judge');
    if (!judge) return 0;
    return Math.max(0, (run.awaitingJudgeTotal ?? judge.total) - judge.done);
}

/** The five slowest steps of the run's ring, longest first (memory's `slowestSteps`). */
export const SLOWEST_STEP_COUNT = 5;
export const slowestOf = (run: Pick<StoredReviewRun, 'steps'>): ReviewStep[] => slowestSteps(run as ReviewRun, SLOWEST_STEP_COUNT);

/** A duration in the reader's words: milliseconds under a second, else seconds, minutes or hours. */
export const durationText = (labels: KnowledgeGraphLabels, ms: number): string =>
    ms < 1000 ? fillTemplate(labels.surface.run.units.ms, { count: Math.round(ms) }) : spanText(labels, ms);

/** The phase a live run is in, if any. */
export const activePhase = (run: StoredReviewRun): ReviewPhase | undefined => phaseRows(run).find((r) => r.state === 'active')?.phase;

/** The lanes of the phase being watched: the active one, else the last phase that had lanes. */
export function lanesOf(run: StoredReviewRun, phase: ReviewPhase | undefined): StoredReviewRun['lanes'] {
    if (phase && run.lanes.some((l) => l.phase === phase)) return run.lanes.filter((l) => l.phase === phase);
    const last = [...run.lanes].map((l) => l.phase).sort((a, b) => RUN_PHASE_ORDER.indexOf(a) - RUN_PHASE_ORDER.indexOf(b)).pop();
    return last ? run.lanes.filter((l) => l.phase === last) : [];
}

export type StepFilter = 'all' | 'failed' | 'skipped' | 'cached';
export const STEP_FILTERS: readonly StepFilter[] = ['all', 'failed', 'skipped', 'cached'];

/** The steps to show: newest first, filtered by outcome. */
export function visibleSteps(steps: readonly ReviewStep[], filter: StepFilter): ReviewStep[] {
    const kept = filter === 'all' ? [...steps] : steps.filter((s) => s.outcome === filter);
    return kept.reverse();
}

/** How long a run took (or has taken so far). */
export const runDurationMs = (run: Pick<StoredReviewRun, 'startedAt' | 'endedAt' | 'updatedAt'>): number => Math.max(0, (run.endedAt ?? run.updatedAt) - run.startedAt);

/** How many files failed in all (a live event carries only the latest few in `failures`). */
export const failureCountOf = (run: Pick<StoredReviewRun, 'failures' | 'failureCount'>): number => run.failureCount ?? run.failures.length;

/** "42 s", "3 min", "2 h": the largest whole unit, in the reader's words. */
export function spanText(labels: KnowledgeGraphLabels, ms: number): string {
    const u = labels.surface.run.units;
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return fillTemplate(u.second, { count: seconds });
    const minutes = Math.round(seconds / 60);
    return minutes < 60 ? fillTemplate(u.minute, { count: minutes }) : fillTemplate(u.hour, { count: Math.round(minutes / 60) });
}

/** A moment, in the reader's locale. */
export const whenText = (at: number): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));

/** The rate as a short number ("12", "3.4"). */
export const rateText = (rate: number): string => (rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1));

export type ReasonKind = keyof KnowledgeGraphLabels['surface']['run']['reasons'];

/** A failure's reason, sorted into the few the person is told in words (the raw text stays in a tooltip). */
export function reasonKind(reason: string): ReasonKind {
    if (/timed? ?out|etimedout/i.test(reason)) return 'timeout';
    if (/\b429\b|rate.?limit|too many requests/i.test(reason)) return 'rateLimit';
    if (/too large|too big|\b413\b|exceeds/i.test(reason)) return 'tooLarge';
    if (/worker|terminated|exited/i.test(reason)) return 'worker';
    if (/eacces|enoent|eperm|\bread\b|decode|unreadable|binary/i.test(reason)) return 'unreadable';
    return 'other';
}

/** The run kind's key in the labels (`re-review` is `reReview`). */
export const kindKey = (kind: StoredReviewRun['kind']): 'review' | 'reReview' | 'seed' => (kind === 're-review' ? 'reReview' : kind);

/** The run's state in words: running until it ends, else its outcome. */
export const outcomeKey = (run: Pick<StoredReviewRun, 'outcome'>): 'running' | 'done' | 'stopped' | 'failed' | 'interrupted' => run.outcome ?? 'running';
