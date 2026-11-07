/** The words of the Run panel (PRD 41 A8): the interface and its English defaults (a host overrides them per key). */

export interface RunLabels {
    run: {
        /** Parallel extraction was unavailable: `{reason}`. */
        poolDown: string;
        /** Section titles. */
        timelineTitle: string;
        lanesTitle: string;
        stepsTitle: string;
        /** The slowest steps, so a stall names itself. */
        slowestTitle: string;
        slowestNone: string;
        /** A step's time split, `{time}` each. */
        partRead: string;
        partLookup: string;
        partPool: string;
        failuresTitle: string;
        historyTitle: string;
        /** `{done}`, `{total}`. */
        phaseProgress: string;
        /** `{rate}` items per second. */
        perSecond: string;
        /** `{time}`: "about 2 min left". */
        eta: string;
        /** `{id}`. */
        laneName: string;
        laneIdle: string;
        lanesNone: string;
        stepsNone: string;
        stepsNoneFiltered: string;
        filterLabel: string;
        failuresNone: string;
        retry: string;
        /** `{path}`. */
        retryAria: string;
        /** The list holds only the latest failures: `{shown}`, `{total}`. */
        failuresTruncated: string;
        retryStarted: string;
        retryFailed: string;
        /** The open run's headline: `{kind}`, `{outcome}`. */
        headline: string;
        /** `{time}`. */
        startedAt: string;
        /** `{time}`. */
        duration: string;
        details: string;
        historyLoading: string;
        historyNone: string;
        historyFailed: string;
        /** `{kind}`, `{started}`. */
        historyOpen: string;
        /** `{started}`. */
        frozenNote: string;
        backToLive: string;
        /** A past run the host no longer holds. */
        runUnavailable: string;
        /** A step's outcome glyph, by outcome (read after the path, never colour alone). */
        stepOutcomes: Record<'ok' | 'cached' | 'skipped' | 'failed', string>;
        filters: Record<'all' | 'failed' | 'skipped' | 'cached', string>;
        kinds: Record<'review' | 'reReview' | 'seed', string>;
        outcomes: Record<'running' | 'done' | 'stopped' | 'failed' | 'interrupted', string>;
        /** A failure's short reason; the raw text stays in the tooltip. */
        reasons: Record<'timeout' | 'rateLimit' | 'tooLarge' | 'unreadable' | 'worker' | 'other', string>;
        /** A time in words: `{count}` of the unit. */
        units: Record<'ms' | 'second' | 'minute' | 'hour', string>;
    };
}

export const RUN_DEFAULTS: RunLabels = {
    run: {
        poolDown: 'Parallel extraction unavailable · {reason} · extracting on one thread',
        timelineTitle: 'Phases',
        lanesTitle: 'Workers',
        stepsTitle: 'Steps',
        slowestTitle: 'Slowest steps',
        slowestNone: 'No steps to rank yet.',
        partRead: 'read {time}',
        partLookup: 'lookup {time}',
        partPool: 'pool {time}',
        failuresTitle: 'Failures',
        historyTitle: 'Past runs',
        phaseProgress: '{done} of {total}',
        perSecond: '{rate}/s',
        eta: 'about {time} left',
        laneName: 'Worker {id}',
        laneIdle: 'idle',
        lanesNone: 'No worker is busy right now.',
        stepsNone: 'No steps yet.',
        stepsNoneFiltered: 'No steps match this filter.',
        filterLabel: 'Show steps',
        failuresNone: 'No file failed.',
        retry: 'Retry',
        retryAria: 'Retry {path}',
        failuresTruncated: 'Only the latest {shown} of {total} failures are listed, and Retry all retries only those.',
        retryStarted: 'A review of the failed files has started.',
        retryFailed: 'The retry could not start.',
        headline: '{kind} · {outcome}',
        startedAt: 'Started {time}',
        duration: 'Took {time}',
        details: 'Run details',
        historyLoading: 'Reading the past runs…',
        historyNone: 'No earlier runs of this folder.',
        historyFailed: 'The past runs could not be read.',
        historyOpen: '{kind}, started {started}',
        frozenNote: 'A finished run from {started}.',
        backToLive: 'Back to the latest run',
        runUnavailable: 'This run is no longer kept.',
        stepOutcomes: { ok: 'done', cached: 'reused', skipped: 'skipped', failed: 'failed' },
        filters: { all: 'All', failed: 'Failed', skipped: 'Skipped', cached: 'Reused' },
        kinds: { review: 'Review', reReview: 'Re-review', seed: 'Server copy' },
        outcomes: { running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed', interrupted: 'Interrupted' },
        reasons: {
            timeout: 'timed out', rateLimit: 'the provider is busy', tooLarge: 'too large', unreadable: 'could not be read',
            worker: 'the worker stopped', other: 'unexpected error',
        },
        units: { ms: '{count} ms', second: '{count} s', minute: '{count} min', hour: '{count} h' },
    },
};
