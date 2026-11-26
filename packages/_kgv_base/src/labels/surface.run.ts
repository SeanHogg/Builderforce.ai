/** The words of the Run panel (PRD 41 A8): the interface and its English defaults (a host overrides them per key). */

import { REVIEW_WORDS, type ReviewWords } from './surface.review';

export interface RunLabels {
    run: {
        /** Parallel extraction was unavailable: `{reason}`. */
        poolDown: string;
        /** Section titles. */
        timelineTitle: string;
        stepsTitle: string;
        /** The slowest steps, so a stall names itself. */
        slowestTitle: string;
        slowestNone: string;
        /** A step's time split, `{time}` each. */
        partRead: string;
        partLookup: string;
        partPool: string;
        historyTitle: string;
        /** `{done}`, `{total}`. */
        phaseProgress: string;
        /** `{rate}` items per second. */
        perSecond: string;
        /** `{time}`: "about 2 min left". */
        eta: string;
        /** Why judging stopped for the run: `{reason}`. */
        judgeStopped: string;
        /** `{id}`. */
        stepsNone: string;
        stepsNoneFiltered: string;
        filterLabel: string;
        retry: string;
        /** `{path}`. */
        retryAria: string;
        /** The list holds only the latest failures: `{shown}`, `{total}`. */
        /** The open run's headline: `{kind}`, `{outcome}`. */
        headline: string;
        /** `{time}`. */
        startedAt: string;
        /** `{time}`. */
        duration: string;
        historyLoading: string;
        historyNone: string;
        historyFailed: string;
        /** `{kind}`, `{started}`. */
        historyOpen: string;
        /** `{started}`. */
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
        /** The Reviews panel's own words (start, watch, stop, past runs) and the pill's review states. */
        review: ReviewWords;
    };
}

export const RUN_DEFAULTS: RunLabels = {
    run: {
        poolDown: 'Parallel extraction unavailable · {reason} · extracting on one thread',
        timelineTitle: 'Phases',
        stepsTitle: 'Steps',
        slowestTitle: 'Slowest steps',
        slowestNone: 'No steps to rank yet.',
        partRead: 'read {time}',
        partLookup: 'lookup {time}',
        partPool: 'pool {time}',
        historyTitle: 'Past runs',
        phaseProgress: '{done} of {total}',
        perSecond: '{rate}/s',
        eta: 'about {time} left',
        judgeStopped: 'Judging stopped: {reason}',
        stepsNone: 'No steps yet.',
        stepsNoneFiltered: 'No steps match this filter.',
        filterLabel: 'Show steps',
        retry: 'Retry',
        retryAria: 'Retry {path}',
        headline: '{kind} · {outcome}',
        startedAt: 'Started {time}',
        duration: 'Took {time}',
        historyLoading: 'Reading the past runs…',
        historyNone: 'No earlier runs of this folder.',
        historyFailed: 'The past runs could not be read.',
        historyOpen: '{kind}, started {started}',
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
        review: REVIEW_WORDS,
    },
};
