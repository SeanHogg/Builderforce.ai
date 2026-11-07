/** The map words of the surface: the interface and its English defaults (a host overrides them per key). */

import type { Layer } from '../surface/layers';
import type { ExternalServiceId } from '@seanhogg/builderforce-memory/knowledge';

/**
 * Every counted sentence of the view: each word has a `${word}One` and a `${word}Other` row in `counts`, and
 * `counted()` (surface/plural.ts) is the ONE way to read them, so no row reads "1 files".
 */
export type CountedWord =
    | 'file' | 'station' | 'deadEnd' | 'finding' | 'line' | 'layer' | 'component' | 'stop' | 'message' | 'endpoint'
    | 'stationChanged' | 'fileMissing' | 'fileTooLarge' | 'fileNotStored' | 'fileBoth' | 'fileChanged' | 'fileSkipped'
    | 'familyLights' | 'checkFile' | 'checkStation' | 'issueAt' | 'notLayered' | 'branchFiles' | 'packFiles'
    | 'sectionUnjudged' | 'fixBatch' | 'findingCollapsed' | 'topNodes' | 'modelCalls' | 'endpointsCapped' | 'commitsCapped'
    | 'moreChecks' | 'fileEndpoints' | 'filesPlotted' | 'applyV8' | 'applyV8Request' | 'entryPointsOmitted' | 'interchange'
    | 'entryPoint' | 'fileServerOnly' | 'fileLocalOnly' | 'pinFindings' | 'moreStations' | 'pipesCapped' | 'commitRow' | 'commitRowAuthor' | 'moreStops' | 'antiTip';

export interface MapLabels {
    /** `{files}`, `{layer}`. */
    stationMeta: string;
    legendTitle: string;
    /** A legend row: `{channel}`, `{metric}`. */
    legendRow: string;
    terminus: Record<'data' | 'external' | 'end', string>;
    untestedSegment: string;
    /** The map's SVG description: `{lines}`, `{stations}`. */
    mapDescription: string;
    /** A station's accessible name: `{name}`, `{layer}`, `{files}`. */
    stationAria: string;
    layers: Record<Layer | 'other', string>;
    /**
     * The System camera: a component's `{name}`, `{files}`, `{findings}`; a card's meta `{files}` (already pluralised, see
     * `counts`) and `{owner}`; the "+N more" card `{count}`, `{layer}`.
     */
    system: Record<'componentAria' | 'antiBar' | 'data' | 'dataEmpty' | 'empty' | 'metaOwner' | 'more' | 'moreAria', string>;
    /** The sentence between two tiers of the System camera, under the tier it follows. */
    systemArrows: Record<Layer, string>;
    /**
     * Counted words, One and Other (`{count}`, plus the sentence's own params): a language with no plural form repeats the
     * one. Read ONLY through `counted()`.
     */
    counts: Record<`${CountedWord}${'One' | 'Other'}`, string>;
    /** The Heat camera: `{layers}`, `{components}`; `{name}`, `{files}`; the legend `{size}`, `{colour}`, `{bar}`. */
    heat: Record<'description' | 'cellAria' | 'legend' | 'empty' | 'showMore', string>;
    /** The mark on a hop that is part of a dependency cycle (map and path strip; never colour alone). */
    cycleHop: string;
    /** The scale note when the map shows only part of the files: `{stations}`, `{files}`, `{nodes}`. */
    scaleSummary: string;
    /** The name of the one station that holds a repo's top-level non-code files (LICENSE, Dockerfile, dotfiles). */
    repoConfig: string;
    /** The Sequence camera: `{stops}`, `{messages}`; `{from}`, `{to}`, `{label}`. */
    sequence: Record<'description' | 'empty' | 'messageAria' | 'backToMap', string>;
    /** The transit map's own words: the station card, the drill levels, docs, termini. `{count}`, `{name}`. */
    map: {
        wall: string;
        describes: string;
        doc: string;
        deadEnd: string;
        reported: string;
        /** The map says why a level shows files. */
        noSymbolsNote: string;
        /** The name of the top level, for "↑ Out to {name}". */
        world: string;
        /** Why the view went back out of a level the map no longer has: `{name}`. */
        drillReset: string;
        /** A satellite sub-station of an unfolded station: `{name}`, `{parent}`. */
        satelliteAria: string;
        card: Record<'close' | 'issueMore' | 'goInside' | 'unfold' | 'fold' | 'whoCalls' | 'apiContract' | 'patterns' | 'noSymbols' | 'leaf' | 'loading', string>;
        /** `reached` replaces `coverage` when the number is a static reach (a heuristic), not a measurement. */
        stats: Record<'issues' | 'complexity' | 'coverage' | 'reached' | 'usage', string>;
        /** The numbers as words: the anti-pattern level (1 to 5), and the importance rank (`{rank}` of `{total}`). */
        statWords: {
            anti: Record<'none' | 'low' | 'medium' | 'high' | 'severe', string>;
            importance: string;
            importanceTip: string;
        };
        bands: Record<'symbol' | 'methods' | 'errors' | 'leaves' | 'body' | 'callees', string>;
        /** One name per external service id (memory's `EXTERNAL_SERVICE_IDS`). */
        names: Record<ExternalServiceId, string>;
    };
    /**
     * The left rail: its heading, and the legend heading with its owner swatch note. A line's second row
     * `{stations}`, `{files}`, `{end}`; a stop's tag `{n}`, `{title}` (its first finding) or `{percent}` (static reach).
     */
    rail: Record<'heading' | 'legendHeading' | 'ownerSwatches' | 'legendEmpty' | 'lineDetail' | 'pinTag' | 'reachedTag', string>;
}

export const MAP_DEFAULTS: MapLabels = {
    stationMeta: '{files} · {layer}',
    legendTitle: 'On the map',
    legendRow: '{channel}: {metric}',
    terminus: { data: 'Data store', external: 'External service', end: 'Ends here' },
    untestedSegment: 'Dashed: no test covers it',
    mapDescription: '{lines} across {stations}. Select a station for its details.',
    stationAria: '{name}, {layer}, {files}',
    layers: {
        entry: 'Entry points', presentation: 'Presentation', application: 'Application', domain: 'Domain',
        infrastructure: 'Infrastructure', other: 'Other',
    },
    system: {
        componentAria: '{name}, {files}, {findings}',
        antiBar: 'Findings by kind',
        data: 'Data and external services',
        dataEmpty: 'No data store or external service ends a line.',
        empty: 'There are no components to draw.',
        metaOwner: '{files} · {owner}',
        more: '+{count} more',
        moreAria: 'Show {count} more in {layer} in the list',
    },
    systemArrows: {
        entry: 'calls over HTTP or a bridge ↓',
        presentation: 'takes an application port ↓',
        application: 'works on the domain ↓',
        domain: 'is implemented by ↓',
        infrastructure: 'reads and writes ↓',
    },
    counts: {
        fileOne: '{count} file', fileOther: '{count} files',
        stationOne: '{count} station', stationOther: '{count} stations',
        deadEndOne: '{count} dead end', deadEndOther: '{count} dead ends',
        findingOne: '{count} finding', findingOther: '{count} findings',
        lineOne: '{count} line', lineOther: '{count} lines',
        layerOne: '{count} layer', layerOther: '{count} layers',
        componentOne: '{count} component', componentOther: '{count} components',
        stopOne: '{count} stop', stopOther: '{count} stops',
        messageOne: '{count} message', messageOther: '{count} messages',
        endpointOne: '{count} endpoint', endpointOther: '{count} endpoints',
        stationChangedOne: '{count} station changed in this commit', stationChangedOther: '{count} stations changed in this commit',
        fileMissingOne: '{count} file is missing on the server.', fileMissingOther: '{count} files are missing on the server.',
        fileTooLargeOne: '{count} file was too large to store.', fileTooLargeOther: '{count} files were too large to store.',
        fileNotStoredOne: '{count} file not stored', fileNotStoredOther: '{count} files not stored',
        fileBothOne: '{count} file here and on the server', fileBothOther: '{count} files here and on the server',
        fileChangedOne: '{count} file changed', fileChangedOther: '{count} files changed',
        fileSkippedOne: '{count} file was not stored.', fileSkippedOther: '{count} files were not stored.',
        familyLightsOne: '{family} lights {count} station', familyLightsOther: '{family} lights {count} stations',
        checkFileOne: 'The finding names {count} file.', checkFileOther: 'The finding names {count} files.',
        checkStationOne: 'It touches {count} station.', checkStationOther: 'It touches {count} stations.',
        issueAtOne: 'At {scope} · {count} issue', issueAtOther: 'At {scope} · {count} issues',
        notLayeredOne: 'Not layered · {count} part → List', notLayeredOther: 'Not layered · {count} parts → List',
        branchFilesOne: '{name}, {count} file', branchFilesOther: '{name}, {count} files',
        packFilesOne: '{pack}: {count} file', packFilesOther: '{pack}: {count} files',
        sectionUnjudgedOne: '{count} section was left for later by the budget.', sectionUnjudgedOther: '{count} sections were left for later by the budget.',
        fixBatchOne: 'Resolve this finding in one change:', fixBatchOther: 'Resolve these {count} findings together, in one change:',
        findingCollapsedOne: '{count} finding — expand to load', findingCollapsedOther: '{count} findings — expand to load',
        topNodesOne: 'Showing the top {count} node.', topNodesOther: 'Showing the top {count} nodes.',
        modelCallsOne: '≈ {count} model call', modelCallsOther: '≈ {count} model calls',
        endpointsCappedOne: 'The request names only the first {count} endpoint.', endpointsCappedOther: 'The request names only the first {count} endpoints.',
        commitsCappedOne: 'Showing only the latest {count} commit.', commitsCappedOther: 'Showing only the latest {count} commits.',
        moreChecksOne: '+{count} more check', moreChecksOther: '+{count} more checks',
        fileEndpointsOne: '{file}: {count} endpoint', fileEndpointsOther: '{file}: {count} endpoints',
        filesPlottedOne: '{count} file plotted. Complexity runs left to right and coverage bottom to top.',
        filesPlottedOther: '{count} files plotted. Complexity runs left to right and coverage bottom to top.',
        applyV8One: 'Apply: v8 coverage in {count} package', applyV8Other: 'Apply: v8 coverage in {count} packages',
        applyV8RequestOne: 'Set up v8 coverage in this {count} package: {packages}. Add the coverage config and a script to it, run the tests with coverage on and report the new coverage.',
        applyV8RequestOther: 'Set up v8 coverage in these {count} packages: {packages}. Add the coverage config and a script to each, run the tests with coverage on and report the new coverage.',
        entryPointsOmittedOne: '{count} more entry point is not drawn as a line.', entryPointsOmittedOther: '{count} more entry points are not drawn as lines.',
        interchangeOne: 'Interchange: {count} line', interchangeOther: 'Interchange: {count} lines',
        entryPointOne: '{count} entry point', entryPointOther: '{count} entry points',
        fileServerOnlyOne: '{server} file on the server · not reviewed on this machine', fileServerOnlyOther: '{server} files on the server · not reviewed on this machine',
        fileLocalOnlyOne: '{local} file here · not on the server', fileLocalOnlyOther: '{local} files here · not on the server',
        pinFindingsOne: '{count} finding at {name}', pinFindingsOther: '{count} findings at {name}',
        moreStationsOne: '+{count} more station is not drawn.', moreStationsOther: '+{count} more stations are not drawn.',
        pipesCappedOne: 'Showing only the first {count} pipe.', pipesCappedOther: 'Showing only the first {count} pipes.',
        commitRowOne: '{sha} · {count} file · {when}', commitRowOther: '{sha} · {count} files · {when}',
        commitRowAuthorOne: '{sha} · {author} · {count} file · {when}', commitRowAuthorOther: '{sha} · {author} · {count} files · {when}',
        moreStopsOne: '+{count} more stop', moreStopsOther: '+{count} more stops',
        antiTipOne: 'from {count} warning', antiTipOther: 'from {count} warnings',
    },
    heat: {
        description: 'Heat grid: {layers}, {components}. Select a cell for its details.',
        cellAria: '{name}, {files}',
        legend: 'Cell size: {size} · Colour: {colour} · Bar: {bar}',
        empty: 'There are no components to draw.',
        showMore: 'Show {count} more',
    },
    cycleHop: 'Dependency cycle',
    scaleSummary: '{stations} stand for {files} · showing the {nodes} most important · search reaches all',
    repoConfig: 'repo config',
    sequence: {
        description: 'Sequence of {stops} and {messages}.',
        empty: 'A sequence needs two stations; this line has one.',
        messageAria: '{from} to {to}: {label}',
        backToMap: 'Back to map',
    },
    map: {
        wall: 'HTTP boundary',
        describes: 'describes',
        doc: 'Document',
        deadEnd: 'Dead end: nothing reads it',
        reported: 'Reported ✓',
        noSymbolsNote: 'This graph has no symbols, so the levels below a package show files.',
        world: 'the whole map',
        drillReset: 'The map changed, so the view went back out of {name}.',
        satelliteAria: '{name}, inside {parent}',
        card: {
            close: 'Close', issueMore: '+{count} more', goInside: 'Go inside ↓', unfold: 'Unfold {count}', fold: 'Fold',
            whoCalls: 'Who calls this?', apiContract: 'API contract', patterns: 'Patterns',
            noSymbols: 'No symbols here: nothing lies further inside.', leaf: 'Outside this level', loading: 'Reading symbols…',
        },
        stats: { issues: 'Anti-patterns', complexity: 'Complexity', coverage: 'Coverage', reached: 'Reached', usage: 'Importance' },
        statWords: {
            anti: { none: 'none', low: 'low', medium: 'medium', high: 'high', severe: 'severe' },
            importance: '#{rank} of {total}',
            importanceTip: 'Relative to the busiest part',
        },
        bands: { symbol: 'Class', methods: 'Methods', errors: 'Errors and tests', leaves: 'Leaves this level', body: 'This function', callees: 'What it calls' },
        names: { postgres: 'Postgres', kv: 'KV · R2', llm: 'LLM providers', github: 'GitHub API', stripe: 'Payments', mail: 'Email', slack: 'Slack', oauth: 'Sign-in provider' },
    },
    rail: {
        heading: 'Lines from the entry points',
        legendHeading: 'Reading the picture now',
        ownerSwatches: 'One colour per owner',
        legendEmpty: 'Nothing is bound to the picture.',
        lineDetail: '{stations} · {files} · {end}',
        pinTag: '{n} · {title}',
        reachedTag: '{percent}% reached',
    },
};
