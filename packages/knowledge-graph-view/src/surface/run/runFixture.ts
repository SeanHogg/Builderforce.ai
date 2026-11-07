/**
 * The Run panel's shared fixtures: a live run mid-extract (two workers, a few steps, one failure) and a
 * finished one. Not a test file; it imports no testing library.
 */

import type { ReviewRunSummary, StoredReviewRun } from '../../types';

export const RUN_AT = Date.UTC(2026, 10, 7, 12, 0, 0);

const steps: StoredReviewRun['steps'] = [
    { path: 'src/a.ts', phase: 'extract', ms: 12, outcome: 'ok', lane: 0 },
    { path: 'docs/c.md', phase: 'extract', ms: 1, outcome: 'cached', lane: 1 },
    { path: 'assets/logo.png', phase: 'extract', ms: 0, outcome: 'skipped' },
    { path: 'src/bad.ts', phase: 'extract', ms: 30, outcome: 'failed', reason: 'Unexpected token }', lane: 0 },
];

/** Six of ten files extracted, 9.5 s in; judging has begun. */
export function liveRun(over: Partial<StoredReviewRun> = {}): StoredReviewRun {
    return {
        id: 'run-live', root: 'docs', kind: 're-review', startedAt: RUN_AT, updatedAt: RUN_AT + 10_000,
        phases: [
            { phase: 'plan', startedAt: RUN_AT, endedAt: RUN_AT + 500, done: 1, total: 1 },
            { phase: 'extract', startedAt: RUN_AT + 500, done: 6, total: 10 },
            { phase: 'judge', startedAt: RUN_AT + 4000, done: 1, total: 4 },
        ],
        lanes: [
            { phase: 'extract', id: 0, path: 'src/bad.ts', done: 3, busyMs: 900 },
            { phase: 'extract', id: 1, path: 'docs/c.md', done: 2, busyMs: 700 },
        ],
        steps,
        failures: [{ path: 'src/bad.ts', phase: 'extract', reason: 'Unexpected token }' }],
        ...over,
    };
}

/** The same run, finished: two failures, the replica queue with work waiting. */
export function finishedRun(over: Partial<StoredReviewRun> = {}): StoredReviewRun {
    return liveRun({
        id: 'run-done', endedAt: RUN_AT + 20_000, updatedAt: RUN_AT + 20_000, outcome: 'done',
        phases: [
            { phase: 'plan', startedAt: RUN_AT, endedAt: RUN_AT + 500, done: 1, total: 1 },
            { phase: 'extract', startedAt: RUN_AT + 500, endedAt: RUN_AT + 9000, done: 10, total: 10 },
            { phase: 'done', startedAt: RUN_AT + 20_000, endedAt: RUN_AT + 20_000, done: 1, total: 1 },
        ],
        failures: [
            { path: 'src/bad.ts', phase: 'extract', reason: 'Unexpected token }' },
            { path: 'src/slow.ts', phase: 'judge', reason: 'request timed out' },
        ],
        replica: { queued: 3, sending: false, skipped: 0, skippedOps: [], failed: [] },
        ...over,
    });
}

export const summaryOf = (run: StoredReviewRun): ReviewRunSummary => {
    const { steps: _steps, lanes: _lanes, failures, ...summary } = run;
    return { ...summary, failureCount: failures.length };
};
