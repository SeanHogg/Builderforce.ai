/**
 * The pace of a review, pure and clock-free: the rate a run read files at, the time a number of files
 * would take at that rate, and the rate of the newest earlier run (the estimate the Start card, the
 * pill's ETA and the stopped card all use). Every number comes from a run record: nothing is assumed.
 */

import type { StoredReviewRun } from '../../types';

/** An earlier run says nothing about pace unless it read at least this many files (a handful of files is mostly start-up). */
export const PACE_MIN_FILES = 200;

/** The part of a run record the pace reads. */
export type PaceRun = Pick<StoredReviewRun, 'startedAt' | 'endedAt' | 'updatedAt' | 'phases'> & { report?: Pick<NonNullable<StoredReviewRun['report']>, 'extracted'> | undefined };

export interface RunPace {
    /** Files read and saved per second. */
    rate: number;
    /** Files the run read. */
    read: number;
}

/**
 * How fast a run read files: the extract phase's `done` over its span; when the summary carries no phases,
 * the report's extracted count over the run's duration. Undefined when nothing was read or no time passed.
 */
export function paceOf(run: PaceRun): RunPace | undefined {
    const end = run.endedAt ?? run.updatedAt;
    const extract = run.phases.find((p) => p.phase === 'extract');
    const read = extract ? extract.done : run.report?.extracted ?? 0;
    const from = extract ? extract.startedAt : run.startedAt;
    const to = extract ? extract.endedAt ?? end : end;
    const ms = to - from;
    return read > 0 && ms > 0 ? { rate: (read * 1000) / ms, read } : undefined;
}

/** The pace of the newest run in `runs` (newest first) that read at least `PACE_MIN_FILES`, skipping `exceptId` (the run on screen). */
export function lastRunPace(runs: readonly (PaceRun & { id: string })[], exceptId?: string): RunPace | undefined {
    for (const run of runs) {
        if (run.id === exceptId) continue;
        const pace = paceOf(run);
        if (pace && pace.read >= PACE_MIN_FILES) return pace;
    }
    return undefined;
}

/** Milliseconds `files` take at `rate` files per second; undefined when the rate is unknown, 0 when nothing is left. */
export function etaMs(files: number, rate: number | undefined): number | undefined {
    if (files <= 0) return 0;
    return rate !== undefined && rate > 0 ? Math.round((files / rate) * 1000) : undefined;
}

export interface ExtractProgress {
    done: number;
    total: number;
    /** 0 to 100, whole. */
    pct: number;
    /** Files per second so far; undefined before any file was read. */
    rate: number | undefined;
    /** Milliseconds left at that rate; undefined when it cannot be told. */
    etaMs: number | undefined;
}

/** Where the read-and-save phase of a run stands, from its own record (the live run's rate and ETA). Undefined before the phase begins. */
export function extractProgress(run: PaceRun): ExtractProgress | undefined {
    const phase = run.phases.find((p) => p.phase === 'extract');
    if (!phase || phase.total <= 0) return undefined;
    const pace = paceOf(run);
    return {
        done: phase.done, total: phase.total, pct: Math.min(100, Math.round((phase.done / phase.total) * 100)),
        rate: pace?.rate, etaMs: etaMs(phase.total - phase.done, pace?.rate),
    };
}

/** One bar of the pace comparison: a run and the rate it read at. */
export interface PaceBar { id: string; startedAt: number; rate: number; frac: number }

/** The runs that have a pace, each scaled to the fastest (frac 0 to 1), in the order given. */
export function paceBars(runs: readonly (PaceRun & { id: string })[]): PaceBar[] {
    const rated = runs.flatMap((r) => { const p = paceOf(r); return p ? [{ id: r.id, startedAt: r.startedAt, rate: p.rate }] : []; });
    const max = Math.max(0, ...rated.map((r) => r.rate));
    return rated.map((r) => ({ ...r, frac: max > 0 ? r.rate / max : 0 }));
}
