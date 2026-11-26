/**
 * Lines: the transit-map reading of a code graph (PRD 38, Option B+). Each entry point (a
 * station holding files of the `entry` partition) starts a line, which follows `references`
 * between stations down through the layers (`lineRoute`). A station on more than one line is an
 * interchange. The last station is the terminus: a data store or an external service when it is
 * infrastructure, otherwise an "ends here" marker; the line also records WHY it stopped. Both
 * are heuristics from names and layers and are marked as such.
 *
 * A root of several systems (PRD 41 A9) allots its MAX_LINES round-robin across the systems,
 * largest first (`lineAllot`), and names each line `system › package`. A stray copy's entries
 * get no line of their own: the copy is folded under its original.
 *
 * Bounded (MAX_LINES lines of at most MAX_STOPS stations) and deterministic.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { allotEntries } from './lineAllot';
import { followRoute, stationEdges, terminusOf, type LineHop, type StopReason, type Terminus } from './lineRoute';
import { mapEdges } from './outlineGraph';
import { packageNameOf } from './stationName';
import type { StationModel } from './stations';
import { isMultiSystem, primarySystems, systemName, systemsOf, type SystemInfo } from './systems';

export { MAX_STOPS } from './lineRoute';
export type { LineHop, StopReason, Terminus, Verdict } from './lineRoute';

export const MAX_LINES = 8;

export interface Line {
    id: string;
    name: string;
    /** Index into the line palette (the surface cycles it). */
    colourIndex: number;
    stops: string[];
    hops: LineHop[];
    terminus: Terminus;
    /** Why the line stops where it does; shown instead of "Ends here" unless it is a real terminus. */
    stopReason: StopReason;
    /** The system (folder) and app the entry station belongs to; absent on a single-system root. */
    system?: string;
    app?: string;
}

export interface LinesModel {
    lines: Line[];
    /** Station id → the ids of the lines that stop there (only stations on more than one). */
    interchanges: Map<string, string[]>;
    /** Entry points past MAX_LINES that were not given a line. */
    omitted: number;
    /** The systems that stand on their own, largest first; absent when the root is not divided into systems. */
    systems?: SystemInfo[];
}

export function buildLines(graph: KnowledgeGraph, model: StationModel): LinesModel {
    // A truncated graph's routes follow the outline's links (verdict codes decoded by the adapter), not the cut graph's edges.
    const edges = stationEdges(mapEdges(graph), model);
    const systems = primarySystems(systemsOf(graph));
    const multi = isMultiSystem(systems);
    const entries = model.stations.filter((s) => s.entry && !s.copy);
    const { chosen, omitted } = allotEntries(entries, systems.map((s) => s.path), MAX_LINES);
    const lines: Line[] = [];

    for (const entry of chosen) {
        const route = followRoute(entry.id, edges, model);
        const last = route.stops[route.stops.length - 1]!;
        const pkg = packageNameOf(entry.name);
        const sys = multi ? systemName(systems, entry.system) : undefined;
        lines.push({
            id: `line:${lines.length + 1}`, name: sys ? `${sys} › ${pkg}` : pkg, colourIndex: lines.length,
            stops: route.stops, hops: route.hops, terminus: terminusOf(model.byId.get(last), last), stopReason: route.stopReason,
            ...(entry.system ? { system: entry.system } : {}), ...(entry.app ? { app: entry.app } : {}),
        });
    }

    const onLines = new Map<string, string[]>();
    for (const line of lines) for (const id of line.stops) (onLines.get(id) ?? onLines.set(id, []).get(id)!).push(line.id);
    const interchanges = new Map([...onLines].filter(([, ids]) => ids.length > 1));
    return { lines, interchanges, omitted, ...(systems.length > 0 ? { systems } : {}) };
}
