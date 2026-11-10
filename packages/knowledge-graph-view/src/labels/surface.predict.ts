/** The words of the predicted measures (PRD 38 P4 co-change, P7 station transitions): the interface and its English defaults. */

export interface PredictLabels {
    predict: {
        /** An observed rate: `{x}` shrunk percent, `{low}`–`{high}` its interval, `{n}` the sample. */
        rate: string;
        /** The same under 10 observations. */
        rateFew: string;
        /** A reference-weight hop: a share of references, not an observed rate. `{k}` of `{n}`. */
        share: string;
        /** "What changed?": the not-yet-touched files that usually change with the changed ones. */
        partnersTitle: string;
        partnersNone: string;
        /** One partner: `{name}`, `{rate}`. */
        partner: string;
        /** The fix flow's tests check: `{tests}` the partners' test files. */
        partnerTests: string;
        partnerTestsNone: string;
        /** A "This path is done when…" line: `{name}`, `{rate}`. */
        doneAlso: string;
        /** "Run to end": the most likely walk on from the last stop. */
        walkTitle: string;
        /** One hop of it: `{name}`, `{rate}`. */
        walkHop: string;
    };
}

export const PREDICT_DEFAULTS: PredictLabels = {
    predict: {
        rate: '{x}% ({low}–{high}) · n = {n}',
        rateFew: '≈ {x}% ({low}–{high}) · n = {n}',
        share: '{k} of {n} references',
        partnersTitle: 'Usually changes with these',
        partnersNone: 'Every file that usually changes with these is already changed.',
        partner: '{name} · {rate}',
        partnerTests: 'Also runs the tests of files that usually change with these: {tests}',
        partnerTestsNone: 'No test was found for the files that usually change with these.',
        doneAlso: '{name} is updated too · {rate}',
        walkTitle: 'Most likely next',
        walkHop: '→ {name} · {rate}',
    },
};
