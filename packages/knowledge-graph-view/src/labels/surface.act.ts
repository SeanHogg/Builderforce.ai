/** The act words of the surface: the interface and its English defaults (a host overrides them per key). */

import type { Provenance } from '../surface/layers';

export interface ActLabels {
    pathTitle: string;
    pathEmpty: string;
    /** `{n}` of `{total}`. */
    pathStep: string;
    pathBack: string;
    pathNext: string;
    /** The edge between two stops: `{kind}`, `{count}`. */
    pathHop: string;
    actScopeAll: string;
    /** `{level}` of 5. */
    levelOf5: string;
    provenance: Record<Provenance, string>;
    /** Resolve on a finding row. */
    resolveFinding: string;
    /** The Resolve button's accessible name, which says which finding: `{title}`. */
    resolveFindingAria: string;
    /** Names the colours of the System camera's finding bar. */
    kindsLegend: string;
    /** A sequence message between stops with no reference between them. */
    noDirectReference: string;
    /** A screenshot over the size limit: `{size}` MB. */
    imageTooLarge: string;
    /**
     * The Act rail. `{action}`, `{title}`, `{count}`, `{path}`, `{stops}`, `{checks}`, `{items}`, `{scope}`.
     * The title is "At {scope} · N issues" (`counts.issueAt`) or, with a line drawn, "On this path · N to act on".
     */
    act: Record<
        'titlePath' | 'emptyTitle' | 'emptyStation' | 'emptyPath' | 'emptyAsk' | 'emptyShow' | 'systemWide' | 'systemWideNote'
        | 'cardsTitle' | 'apply' | 'prompt' | 'show' | 'cardAction' | 'sourceExact' | 'sourceAnalyzer' | 'sourceModel' | 'fixQueue'
        | 'keepTitle' | 'keepBody' | 'keepButton' | 'testRequest' | 'doneTitle' | 'doneCheck' | 'doneNone' | 'detailsTitle'
        | 'linkCoverage' | 'linkApi',
        string
    >;
    /** The path strip. `{line}`, `{entry}`, `{count}`. */
    path: Record<'title' | 'reset' | 'step' | 'runToEnd' | 'simulate' | 'sequence' | 'noTests' | 'stops' | 'enlarge', string>;
}

export const ACT_DEFAULTS: ActLabels = {
    pathTitle: 'Path',
    pathEmpty: 'Pick a line or a station to read its path.',
    pathStep: 'Stop {n} of {total}',
    pathBack: 'Previous stop',
    pathNext: 'Next stop',
    pathHop: '{kind} · {count}',
    actScopeAll: 'Whole graph',
    levelOf5: '{level} of 5',
    provenance: { deterministic: 'Deterministic', heuristic: 'Heuristic', runtime: 'Runtime' },
    resolveFinding: 'Resolve',
    resolveFindingAria: 'Resolve: {title}',
    kindsLegend: 'Finding kinds',
    noDirectReference: 'no direct reference',
    imageTooLarge: 'That image is larger than {size} MB.',
    act: {
        titlePath: 'On this path · {count} to act on',
        emptyTitle: 'Nothing to act on here',
        emptyStation: 'No open findings at this station. Try “What has no test?”',
        emptyPath: 'No open findings on this path. Try “What has no test?”',
        emptyAsk: 'Ask what has no test',
        emptyShow: 'Show',
        systemWide: 'System-wide · {count}',
        systemWideNote: 'These touch most of the system, so no single station carries them.',
        cardsTitle: 'Fix these first',
        apply: 'Apply',
        prompt: 'Prompt',
        show: 'Show',
        cardAction: '{action}: {title}',
        sourceExact: 'Exact',
        sourceAnalyzer: 'Analyzer',
        sourceModel: 'Model',
        fixQueue: 'Fix queue · {count}',
        keepTitle: 'Keep this run as a test',
        keepBody: 'Turn {path} into a test that fails when one of its hops breaks.',
        keepButton: 'Prompt a test',
        testRequest: 'Write an integration test that drives the path {path}. The stops, in order: {stops}. Assert that every hop still happens and that none of these findings comes back: {checks}.',
        doneTitle: 'This path is done when…',
        doneCheck: '{title} is resolved in {items}',
        doneNone: 'No finding is open on this path.',
        detailsTitle: 'Details',
        linkCoverage: 'Coverage',
        linkApi: 'API',
    },
    path: {
        title: '{line} · {entry}',
        reset: 'Reset',
        step: 'Step',
        runToEnd: 'Run to end',
        simulate: 'Simulate with values',
        sequence: 'Sequence',
        noTests: 'no tests',
        stops: 'Stops',
        enlarge: 'Enlarge',
    },
};
