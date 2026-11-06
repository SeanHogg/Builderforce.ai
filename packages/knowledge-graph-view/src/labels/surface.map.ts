/** The map words of the surface: the interface and its English defaults (a host overrides them per key). */

import type { Layer } from '../surface/layers';
import type { ExternalServiceId } from '@seanhogg/builderforce-memory/knowledge';

export interface MapLabels {
    /** `{count}` entry points left without a line. */
    omittedLines: string;
    /** `{files}`, `{layer}`. */
    stationMeta: string;
    legendTitle: string;
    /** A legend row: `{channel}`, `{metric}`. */
    legendRow: string;
    /** `{count}` lines. */
    interchange: string;
    terminus: Record<'data' | 'external' | 'end', string>;
    untestedSegment: string;
    /** The map's SVG description: `{lines}`, `{stations}`. */
    mapDescription: string;
    /** A station's accessible name: `{name}`, `{layer}`, `{files}`. */
    stationAria: string;
    /** A pin's accessible name: `{count}`, `{name}`. */
    pinAria: string;
    /** Stations left off the map by its cap: `{count}`. */
    moreStations: string;
    layers: Record<Layer | 'other', string>;
    /** The Tower draws only the first pipes: `{count}`. */
    pipesCapped: string;
    /** The System camera: `{tiers}`, `{components}`; a component's name `{name}`, `{files}`, `{findings}`. */
    system: Record<'description' | 'componentAria' | 'antiBar' | 'data' | 'dataEmpty' | 'empty', string>;
    /** The Heat camera: `{layers}`, `{components}`; `{name}`, `{files}`; the legend `{size}`, `{colour}`, `{bar}`. */
    heat: Record<'description' | 'cellAria' | 'legend' | 'empty' | 'showMore', string>;
    /** The mark on a hop that is part of a dependency cycle (map and path strip; never colour alone). */
    cycleHop: string;
    /** The scale note when the map shows only part of the files: `{shown}`, `{total}`. */
    mapShows: string;
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
        /** The stop that stands for the stations of a line that are not drawn: `{count}`. */
        moreStops: string;
        /** A satellite sub-station of an unfolded station: `{name}`, `{parent}`. */
        satelliteAria: string;
        card: Record<'close' | 'issueMore' | 'goInside' | 'unfold' | 'fold' | 'whoCalls' | 'apiContract' | 'patterns' | 'noSymbols' | 'leaf' | 'loading', string>;
        stats: Record<'issues' | 'complexity' | 'coverage' | 'usage', string>;
        bands: Record<'symbol' | 'methods' | 'errors' | 'leaves' | 'body' | 'callees', string>;
        /** One name per external service id (memory's `EXTERNAL_SERVICE_IDS`). */
        names: Record<ExternalServiceId, string>;
    };
    /** The left rail: its heading, and the legend heading with its owner swatch note. */
    rail: Record<'heading' | 'legendHeading' | 'ownerSwatches' | 'legendEmpty', string>;
}

export const MAP_DEFAULTS: MapLabels = {
    omittedLines: '{count} more entry points are not drawn as lines.',
    stationMeta: '{files} files · {layer}',
    legendTitle: 'On the map',
    legendRow: '{channel}: {metric}',
    interchange: 'Interchange: {count} lines',
    terminus: { data: 'Data store', external: 'External service', end: 'Ends here' },
    untestedSegment: 'Dashed: no test covers it',
    mapDescription: '{lines} lines across {stations} stations. Select a station for its details.',
    stationAria: '{name}, {layer}, {files} files',
    pinAria: '{count} findings at {name}',
    moreStations: '+{count} more stations are not drawn.',
    layers: {
        entry: 'Entry points', presentation: 'Presentation', application: 'Application', domain: 'Domain',
        infrastructure: 'Infrastructure', other: 'Other',
    },
    pipesCapped: 'Showing only the first {count} pipes.',
    system: {
        description: 'System view: {tiers} tiers, {components} components. Select a component for its details.',
        componentAria: '{name}, {files} files, {findings} findings',
        antiBar: 'Findings by kind',
        data: 'Data and external services',
        dataEmpty: 'No data store or external service ends a line.',
        empty: 'There are no components to draw.',
    },
    heat: {
        description: 'Heat grid: {layers} layers, {components} components. Select a cell for its details.',
        cellAria: '{name}, {files} files',
        legend: 'Cell size: {size} · Colour: {colour} · Bar: {bar}',
        empty: 'There are no components to draw.',
        showMore: 'Show {count} more',
    },
    cycleHop: 'Dependency cycle',
    mapShows: 'Map shows {shown} of {total} files',
    sequence: {
        description: 'Sequence of {stops} stops and {messages} messages.',
        empty: 'Pick a line or a station to draw its sequence.',
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
        moreStops: '+{count} more stops',
        satelliteAria: '{name}, inside {parent}',
        card: {
            close: 'Close', issueMore: '+{count} more', goInside: 'Go inside ↓', unfold: 'Unfold {count}', fold: 'Fold',
            whoCalls: 'Who calls this?', apiContract: 'API contract', patterns: 'Patterns',
            noSymbols: 'No symbols here: nothing lies further inside.', leaf: 'Outside this level', loading: 'Reading symbols…',
        },
        stats: { issues: 'Issues', complexity: 'Complexity', coverage: 'Coverage', usage: 'Usage' },
        bands: { symbol: 'Class', methods: 'Methods', errors: 'Errors and tests', leaves: 'Leaves this level', body: 'This function', callees: 'What it calls' },
        names: { postgres: 'Postgres', kv: 'KV · R2', llm: 'LLM providers', github: 'GitHub API', stripe: 'Payments', mail: 'Email', slack: 'Slack', oauth: 'Sign-in provider' },
    },
    rail: {
        heading: 'Lines from the entry points',
        legendHeading: 'Reading the picture now',
        ownerSwatches: 'One colour per owner',
        legendEmpty: 'Nothing is bound to the picture.',
    },
};
