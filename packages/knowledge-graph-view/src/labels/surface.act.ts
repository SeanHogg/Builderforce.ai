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
        | 'keepTitle' | 'keepBody' | 'keepButton' | 'testRequest' | 'doneTitle' | 'doneCheck' | 'doneNone' | 'detailsTitle',
        string
    >;
    /** The path strip. `{line}`, `{entry}`, `{count}`. */
    path: Record<'title' | 'journey' | 'reset' | 'step' | 'runToEnd' | 'simulate' | 'sequence' | 'noTests' | 'stops' | 'enlarge', string>;
    /**
     * Plain-language walkthrough of a journey. A door is an entry point or an endpoint, a hallway
     * is a call between rooms, and a room is a module or a class.
     * `{name}`, `{from}`, `{to}`, `{count}`, `{hallway}`, `{place}`.
     */
    walk: WalkLabels;
    /** The depth trail (system › module › class › method). `{name}`. */
    depth: DepthLabels;
}

/** The words of one journey step, filled by `walkthroughSentence`. */
export interface WalkLabels {
    /** Entry door: `{name}`. */
    doorIn: string;
    /** Endpoint door: `{name}`. */
    doorOut: string;
    /** A room along the way: `{name}`. */
    room: string;
    /** A hallway of several calls: `{from}`, `{to}`, `{count}`. */
    hallway: string;
    /** A hallway of one call: `{from}`, `{to}`. */
    hallwayOne: string;
    /** Nothing calls across: `{from}`, `{to}`. */
    hallwayNone: string;
    /** Hallway sentence plus where you arrive: `{hallway}`, `{place}`. */
    arrived: string;
    /** A journey of one room: `{name}`. */
    only: string;
    /** No journey to walk. */
    empty: string;
    /** The metaphor, said once beside the action cards. */
    metaphor: string;
}

/** The words of the depth trail. */
export interface DepthLabels {
    aria: string;
    system: string;
    module: string;
    class: string;
    method: string;
    /** Climb back to a crumb: `{name}`. */
    climb: string;
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
    },
    path: {
        title: '{line} · {entry}',
        journey: 'Journey',
        reset: 'Reset',
        step: 'Step',
        runToEnd: 'Run to end',
        simulate: 'Simulate with values',
        sequence: 'Sequence',
        noTests: 'no tests',
        stops: 'Stops',
        enlarge: 'Enlarge',
    },
    walk: {
        doorIn: 'Start at the door {name}, where this journey begins.',
        doorOut: 'Leave through the door {name}.',
        room: 'You are in the room {name}.',
        hallway: 'Walk the hallway from {from} to {to} ({count} calls).',
        hallwayOne: 'Walk the hallway from {from} to {to} (one call).',
        hallwayNone: 'There is no hallway from {from} to {to}.',
        arrived: '{hallway} {place}',
        only: 'You are in the room {name}. There is no hallway yet.',
        empty: 'Choose a journey to walk the doors, hallways and rooms.',
        metaphor: 'Doors are where you enter and leave. Hallways are calls between rooms. Rooms are modules and classes.',
    },
    depth: {
        aria: 'Depth',
        system: 'System',
        module: 'Module',
        class: 'Class',
        method: 'Method',
        climb: 'Back to {name}',
    },
};
