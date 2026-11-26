import { describe, expect, it } from 'vitest';
import { etaMs, extractProgress, lastRunPace, paceBars, paceOf, PACE_MIN_FILES, type PaceRun } from './runPace';

const T0 = 1_000_000;
const run = (id: string, over: Partial<PaceRun> & { done?: number; extractMs?: number } = {}): PaceRun & { id: string } => {
    const { done = 600, extractMs = 60_000, ...rest } = over;
    return {
        id, startedAt: T0, endedAt: T0 + extractMs + 5000, updatedAt: T0 + extractMs + 5000,
        phases: [{ phase: 'extract', startedAt: T0 + 1000, endedAt: T0 + 1000 + extractMs, done, total: done }],
        ...rest,
    };
};

describe('paceOf', () => {
    it('is the extract phase done over its span, per second', () => {
        expect(paceOf(run('a', { done: 600, extractMs: 60_000 }))).toEqual({ rate: 10, read: 600 });
    });

    it('falls back to the report and the run duration when the summary has no phases', () => {
        const bare: PaceRun = { startedAt: T0, endedAt: T0 + 100_000, updatedAt: T0 + 100_000, phases: [], report: { extracted: 500 } };
        expect(paceOf(bare)).toEqual({ rate: 5, read: 500 });
    });

    it('measures a phase still going to the run clock', () => {
        const live: PaceRun = { startedAt: T0, updatedAt: T0 + 10_000, phases: [{ phase: 'extract', startedAt: T0, done: 50, total: 100 }] };
        expect(paceOf(live)).toEqual({ rate: 5, read: 50 });
    });

    it('is undefined when nothing was read or no time passed', () => {
        expect(paceOf(run('a', { done: 0 }))).toBeUndefined();
        expect(paceOf(run('a', { extractMs: 0 }))).toBeUndefined();
    });
});

describe('lastRunPace', () => {
    it('takes the newest run that read at least the minimum, skipping short ones and the run on screen', () => {
        const runs = [run('now', { done: 900 }), run('tiny', { done: PACE_MIN_FILES - 1 }), run('good', { done: 400, extractMs: 20_000 }), run('old', { done: 900 })];
        expect(lastRunPace(runs, 'now')).toEqual({ rate: 20, read: 400 });
        expect(lastRunPace(runs)?.read).toBe(900);
    });

    it('accepts exactly the minimum', () => {
        expect(lastRunPace([run('edge', { done: PACE_MIN_FILES })])?.read).toBe(PACE_MIN_FILES);
    });

    it('is undefined with no history, or only short runs', () => {
        expect(lastRunPace([])).toBeUndefined();
        expect(lastRunPace([run('a', { done: 50 }), run('b', { done: 199 })])).toBeUndefined();
    });
});

describe('etaMs', () => {
    it('is files over rate, in ms', () => {
        expect(etaMs(100, 4)).toBe(25_000);
    });
    it('is 0 when nothing is left and undefined when the rate is unknown', () => {
        expect(etaMs(0, undefined)).toBe(0);
        expect(etaMs(10, undefined)).toBeUndefined();
        expect(etaMs(10, 0)).toBeUndefined();
    });
});

describe('extractProgress', () => {
    it('reads done, total, percent, rate and ETA from the run', () => {
        const live: PaceRun = { startedAt: T0, updatedAt: T0 + 10_000, phases: [{ phase: 'extract', startedAt: T0, done: 50, total: 200 }] };
        expect(extractProgress(live)).toEqual({ done: 50, total: 200, pct: 25, rate: 5, etaMs: 30_000 });
    });
    it('is undefined before the phase begins', () => {
        expect(extractProgress({ startedAt: T0, updatedAt: T0, phases: [] })).toBeUndefined();
    });
});

describe('paceBars', () => {
    it('scales each run to the fastest', () => {
        const bars = paceBars([run('slow', { done: 300, extractMs: 60_000 }), run('fast', { done: 600, extractMs: 30_000 })]);
        expect(bars.map((b) => [b.id, b.rate, b.frac])).toEqual([['slow', 5, 0.25], ['fast', 20, 1]]);
    });
    it('leaves out a run with no pace', () => {
        expect(paceBars([run('none', { done: 0 })])).toEqual([]);
    });
});
