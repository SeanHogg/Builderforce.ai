/** The header words of the surface: the interface and its English defaults (a host overrides them per key). */

import type { ChannelId, MetricId, PresetId } from '../surface/overlays';
import type { NoteKey, QuestionId } from '../surface/questions';

export interface HeaderLabels {
    spineLabel: string;
    panelsLabel: string;
    overlaysButton: string;
    overlaysTitle: string;
    /** The overlay button's name: `{preset}`. */
    presetLabel: string;
    presets: Record<PresetId | 'custom', string>;
    channels: Record<ChannelId | 'pins', string>;
    metricNames: Record<MetricId, string>;
    notSetUp: string;
    on: string;
    off: string;
    questionsLabel: string;
    moreQuestions: string;
    questions: Record<QuestionId, string>;
    /** A question's answer line: `{count}` stations. */
    answerCount: string;
    answerNone: string;
    /** The question needs data this folder has not collected. */
    answerNotSetUp: string;
    /** A lit station's note; `{value}`. */
    notes: Record<NoteKey, string>;
    linesTitle: string;
    linesButton: string;
    linesEmpty: string;
    /** `{name}`. */
    lineName: string;
    /** `{count}`. */
    lineStops: string;
    /** `{name}`. */
    stationsOn: string;
    stationsPick: string;
    /** The scene overlay: `{name}` the level above; `{lens}`; `{family}`; `{count}` files missing on the server. */
    overlay: Record<'outTo' | 'fit' | 'lensSub' | 'familyOnly' | 'clearFamily' | 'missingFiles' | 'diagnose' | 'controls' | 'tooLarge', string>;
    /** `{description}`, `{path}`, `{findings}`. */
    pinpoint: Record<
        'label' | 'button' | 'hint' | 'reading' | 'failed' | 'noMatch' | 'thumbAlt' | 'descriptionTitle' | 'anchorsTitle' | 'matchesTitle' | 'diagnose'
        | 'diagnoseText' | 'noFindings' | 'clear' | 'clearAria' | 'dropHere' | 'notImage',
        string
    >;
    pinpointProvenance: Record<'vision' | 'exact' | 'catalog' | 'import', string>;
    /** `{title}`, `{at}`, `{count}`. */
    time: Record<'label' | 'aria' | 'now' | 'commitAria' | 'changed', string>;
    /** The header: the status strip (`{time}`, `{progress}`, `{count}`, `{local}`, `{server}`), the overflow menu (`{title}`) and the overlay sentence. */
    header: Record<
        'statusLabel' | 'syncedAt' | 'synced' | 'notSynced' | 'updateFailed' | 'reviewing' | 'reviewPlan' | 'reviewFailed' | 'skippedPill'
        | 'parityBoth' | 'parityDiffers' | 'parityLocal' | 'moreActions' | 'reReview' | 'overlaysNote' | 'rootsLabel',
        string
    >;
    /** The ask bar's placeholder per question, as a sentence; `{name}` is the station, the line or the folder. */
    askSentence: Record<QuestionId, string>;
    /** The ask bar's note per question: how it is answered. */
    answerMode: Record<QuestionId, string>;
    /** A drawer's subtitle, by panel id. */
    drawerSubtitle: Record<'sync' | 'coverage' | 'patterns' | 'api' | 'resolve' | 'simulate', string>;
}

export const HEADER_DEFAULTS: HeaderLabels = {
    spineLabel: 'Where you are',
    panelsLabel: 'Panels',
    overlaysButton: 'Overlays',
    overlaysTitle: 'What the map shows',
    presetLabel: '{preset} overlays',
    presets: { risk: 'Risk', quality: 'Quality', activity: 'Activity', ownership: 'Ownership', custom: 'Custom' },
    channels: { colour: 'Colour', size: 'Size · height', ring: 'Ring · fill · bar', width: 'Line width', pulse: 'Pulse', outline: 'Outline', pins: 'Issue pins' },
    metricNames: { anti: 'Anti-patterns', cx: 'Complexity', cov: 'Coverage gap', use: 'Usage', churn: 'Churn', changed: 'Changed', owner: 'Owner', none: 'Off' },
    notSetUp: 'Not set up',
    on: 'On',
    off: 'Off',
    questionsLabel: 'Questions',
    moreQuestions: 'More questions',
    questions: {
        where: 'Where does it go?', wrong: 'What is wrong?', untested: 'What has no test?', patterns: 'What patterns are here?',
        changed: 'What changed?', callers: 'Who else calls these?', copied: 'What is copied?', unused: 'What is never called?',
        claims: 'What do the docs claim?', layers: 'How is it layered?', knowledge: 'What do we know about it?',
    },
    answerCount: '{count} stations',
    answerNone: 'No station matches.',
    answerNotSetUp: 'Not set up: this needs data that has not been collected.',
    notes: {
        patterns: '{value}', copied: '{value} clone groups', unused: '{value} unused', claims: '{value} claims',
        layers: '{value}', knowledge: '{value} facts', changed: 'Changed',
    },
    linesTitle: 'Lines',
    linesButton: 'Lines',
    linesEmpty: 'No entry points were found, so there are no lines.',
    lineName: '{name} line',
    lineStops: '{count} stops',
    stationsOn: 'Stations on {name}',
    stationsPick: 'Pick a line to list its stations.',
    overlay: {
        outTo: '↑ Out to {name}',
        fit: 'Fit',
        lensSub: 'was the {lens} lens',
        familyOnly: '{family} only',
        clearFamily: 'Clear the {family} filter',
        missingFiles: '{count} files are missing on the server.',
        tooLarge: '{count} files were too large to store.',
        diagnose: 'Diagnose',
        controls: 'Scene controls',
    },
    pinpoint: {
        label: 'Screenshot',
        button: 'Screenshot',
        hint: 'Paste, drop or pick a screenshot to find the code behind it.',
        reading: 'Reading the screenshot…',
        failed: 'The screenshot could not be read.',
        noMatch: 'Nothing in the code matched this screenshot.',
        thumbAlt: 'Your screenshot',
        descriptionTitle: 'What it shows',
        anchorsTitle: 'Text read from the image',
        matchesTitle: 'Where it is in the code',
        diagnose: 'Diagnose with the agent',
        diagnoseText: 'A screenshot shows: {description}. The code behind it, in order: {path}. Findings on that path: {findings}. Find out what is wrong and fix it.',
        noFindings: 'none',
        clear: 'Clear',
        dropHere: 'Drop a screenshot here',
        clearAria: 'Clear screenshot',
        notImage: 'That file is not an image.',
    },
    pinpointProvenance: { vision: 'Vision', exact: 'Exact match', catalog: 'Catalog key', import: 'Import' },
    time: {
        label: 'Review',
        aria: 'History: pick a commit to mark the stations it changed',
        now: 'Now',
        commitAria: '{title}, {at}',
        changed: '{count} stations changed in this commit',
    },
    header: {
        statusLabel: 'Sync status',
        syncedAt: 'Synced {time}',
        synced: 'Synced',
        notSynced: 'Not synced',
        updateFailed: 'Couldn’t update',
        reviewing: 'Reviewing · {progress}',
        reviewPlan: 'Review plan ready',
        reviewFailed: 'Review failed',
        skippedPill: '{count} files not stored',
        parityBoth: '{count} files here and on the server',
        parityDiffers: '{local} here · {server} on the server',
        parityLocal: '{local} files here · not on the server',
        moreActions: 'More actions',
        reReview: 'Re-review this folder',
        overlaysNote: 'Any metric can drive any channel. Map, System, Graph, Mind map, Tower, Heat, List and Sequence all read the same bindings, so a coverage bar can just as well be an anti-pattern bar.',
        rootsLabel: 'Reviewed folders',
    },
    askSentence: {
        where: 'where does {name} go?', wrong: 'what is wrong on {name}?', untested: 'what has no test on {name}?', patterns: 'which patterns are in {name}?',
        changed: 'what changed since the review?', callers: 'who else calls {name}?', copied: 'what code is copied?', unused: 'what is never called?',
        claims: 'what do the docs say, and is it true?', layers: 'which layer is each part in?', knowledge: 'what does memory know about {name}?',
    },
    answerMode: {
        where: 'answered as a path', wrong: 'answered as issues', untested: 'dashed = no test runs it', patterns: 'answered as patterns',
        changed: 'answered as commits', callers: 'answered as links', copied: 'answered as clone groups', unused: 'answered as unused code',
        claims: 'answered as claims', layers: 'answered as layers', knowledge: 'answered as facts',
    },
    drawerSubtitle: {
        sync: 'local first, small batches, merged by file hash', coverage: 'tests, reach and gaps across the system',
        patterns: 'design, enterprise and anti-patterns by layer', api: 'what the routes promise, what is tested, try it',
        resolve: 'a deterministic fix or a prompt, then verify', simulate: 'run the path with real values',
    },
};
