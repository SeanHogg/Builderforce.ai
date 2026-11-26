/**
 * The Key Features model — PURE: what the product DOES, read from the code graph alone (no model call). Five
 * groups, each an existing deterministic reading re-ranked, never a new parse:
 *  - capabilities: the stations (named areas / folders) by importance, then size;
 *  - endpoints: the `routes` badge as the API drawer reads it (`endpointsOf`), most called first;
 *  - entry points: the source files of the `entry` layer (CLIs, workers, mains) by importance;
 *  - patterns: the pattern families as the Patterns drawer counts them (`patternMatrix`);
 *  - core: the most depended-on files (`hotspotsOf` fan-in over `references`).
 * Every list is ranked by its number, ties by id, and capped at {@link FEATURE_CAP} with the full count kept, so
 * equal graphs give equal features and a cut list says how much it left out.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { labelFor, nodeIndex } from '../../graphModel';
import { hotspotsOf } from '../../insights/hotspots';
import { cmp, importanceOf } from '../../order';
import { endpointsOf, requestLine } from '../drawers/apiModel';
import { patternMatrix } from '../drawers/patternsModel';
import { mapEdges } from '../outlineGraph';
import { sourceFilesOf } from '../sourceFiles';
import type { StationModel } from '../stations';

/** Features shown per group; the rest are counted, never drawn. */
export const FEATURE_CAP = 12;

/** The edge kind that means "depends on" in the code pack. */
const DEPENDS: ReadonlySet<string> = new Set(['references']);

export type FeatureGroup = 'capabilities' | 'endpoints' | 'entryPoints' | 'patterns' | 'core';
export const FEATURE_GROUPS: readonly FeatureGroup[] = ['capabilities', 'endpoints', 'entryPoints', 'patterns', 'core'];

export interface Feature {
    /** Stable within its group. */
    id: string;
    /** The name: a station, a request line, a file name, a pattern. */
    label: string;
    /** Where it lives (a path or a file name): data, shown as is. */
    detail?: string;
    /** The number that ranked it: files (capabilities, patterns), callers (endpoints), importance (entry points), dependents (core). */
    count: number;
    /** What selecting it selects: a file ref, or a station. */
    ref?: string;
    stationId?: string;
}

export interface FeatureList { items: Feature[]; total: number }
export type KeyFeatures = Record<FeatureGroup, FeatureList>;

const byCount = (a: Feature, b: Feature): number => b.count - a.count || cmp(a.id, b.id);
/** The first {@link FEATURE_CAP} of an already-ranked list, and how many there were. */
const capped = (ranked: Feature[]): FeatureList => ({ items: ranked.slice(0, FEATURE_CAP), total: ranked.length });
const tail = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

type Model = Pick<StationModel, 'stations' | 'stationOf' | 'byId'>;

function capabilities(model: Model): Feature[] {
    // Ranked by importance (`use`, 0–1), then size; the number shown is the files.
    return [...model.stations]
        .sort((a, b) => b.use - a.use || b.files - a.files || cmp(a.id, b.id))
        .map((s) => ({ id: s.id, label: s.name, ...(s.path ? { detail: s.path } : {}), count: s.files, stationId: s.id }));
}

function endpoints(graph: KnowledgeGraph, model: Model): Feature[] {
    return endpointsOf(graph, model).map((e) => ({
        id: `${e.file} ${requestLine(e)}`, label: requestLine(e), detail: e.fileName, count: e.callers.length, ref: e.file,
        ...(e.stationId ? { stationId: e.stationId } : {}),
    }));
}

function entryPoints(graph: KnowledgeGraph): Feature[] {
    return sourceFilesOf(graph)
        .filter((n) => n.partition === 'entry')
        .map((n) => ({ id: n.ref, label: tail(n.label), detail: n.label, count: importanceOf(n), ref: n.ref }));
}

function patterns(graph: KnowledgeGraph, model: Model): Feature[] {
    return patternMatrix(graph, model).families.map((f) => ({ id: f.id, label: f.id, count: f.refs.length, ...(f.refs[0] ? { ref: f.refs[0] } : {}) }));
}

function core(graph: KnowledgeGraph): Feature[] {
    const top = hotspotsOf(mapEdges(graph), DEPENDS, FEATURE_CAP).fanIn;
    const wanted = new Set(top.map((h) => h.id));
    const index = nodeIndex({ nodes: graph.nodes.filter((n) => wanted.has(n.ref)) });
    return top.map((h) => {
        const label = labelFor(index, h.id);
        return { id: h.id, label: tail(label), detail: label, count: h.value, ref: h.id };
    });
}

/** The key features of the graph. Deterministic: pure reads and sorts, no model call, no clock. */
export function keyFeaturesOf(graph: KnowledgeGraph, model: Model): KeyFeatures {
    return {
        capabilities: capped(capabilities(model)),
        endpoints: capped(endpoints(graph, model).sort(byCount)),
        entryPoints: capped(entryPoints(graph).sort(byCount)),
        patterns: capped(patterns(graph, model).sort(byCount)),
        // `hotspotsOf` already ranks (value, then ref) and caps.
        core: capped(core(graph)),
    };
}
