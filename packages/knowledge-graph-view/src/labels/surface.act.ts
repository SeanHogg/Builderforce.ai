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
    actTitle: string;
    /** `{scope}`. */
    actScope: string;
    actScopeAll: string;
    showFiles: string;
    /** `{level}` of 5. */
    levelOf5: string;
    stationFacts: string;
    provenance: Record<Provenance, string>;
    /** Resolve on a finding row. */
    resolveFinding: string;
    /** The Resolve button's accessible name, which says which finding: `{title}`. */
    resolveFindingAria: string;
    /** Names the colours of the System camera's finding bar. */
    kindsLegend: string;
    /** A sequence message between stops with no reference between them. */
    noDirectReference: string;
    /** The contract-tests request names only the first `{count}` endpoints. */
    testsCapped: string;
    /** A screenshot over the size limit: `{size}` MB. */
    imageTooLarge: string;
    /** The time slider draws only the latest `{count}` commits. */
    historyCapped: string;
    /** The Act rail. `{action}`, `{title}`, `{count}`, `{path}`, `{stops}`, `{checks}`, `{items}`. */
    act: Record<
        'cardsTitle' | 'noCards' | 'apply' | 'prompt' | 'show' | 'cardAction' | 'sourceExact' | 'sourceAnalyzer' | 'sourceModel' | 'fixQueue'
        | 'keepTitle' | 'keepBody' | 'keepButton' | 'testRequest' | 'doneTitle' | 'doneCheck' | 'doneNone' | 'doneMore' | 'detailsTitle'
        | 'linkCoverage' | 'linkApi',
        string
    >;
    /** The path strip. `{line}`, `{entry}`, `{count}`. */
    path: Record<'title' | 'reset' | 'step' | 'runToEnd' | 'simulate' | 'sequence' | 'noTests' | 'findings' | 'stops' | 'enlarge', string>;
}

export const ACT_DEFAULTS: ActLabels = {
    pathTitle: 'Path',
    pathEmpty: 'Pick a line or a station to read its path.',
    pathStep: 'Stop {n} of {total}',
    pathBack: 'Previous stop',
    pathNext: 'Next stop',
    pathHop: '{kind} · {count}',
    actTitle: 'Act',
    actScope: 'Scope: {scope}',
    actScopeAll: 'Whole graph',
    showFiles: 'Show files',
    levelOf5: '{level} of 5',
    stationFacts: 'About this station',
    provenance: { deterministic: 'Deterministic', heuristic: 'Heuristic', runtime: 'Runtime' },
    resolveFinding: 'Resolve',
    resolveFindingAria: 'Resolve: {title}',
    kindsLegend: 'Finding kinds',
    noDirectReference: 'no direct reference',
    testsCapped: 'The request names only the first {count} endpoints.',
    imageTooLarge: 'That image is larger than {size} MB.',
    historyCapped: 'Showing only the latest {count} commits.',
    act: {
        cardsTitle: 'Fix these first',
        noCards: 'Nothing to fix here.',
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
        doneMore: '+{count} more checks',
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
        findings: '{count} findings',
        stops: 'Stops',
        enlarge: 'Enlarge',
    },
};
