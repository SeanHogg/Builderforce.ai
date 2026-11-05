/**
 * Lines: the transit-map reading of a code graph (PRD 38, Option B+). Each entry point (a
 * station holding files of the `entry` partition) starts a line, which follows `references`
 * between stations down through the layers, always to the strongest unvisited next station.
 * A station on more than one line is an interchange. The last station is the terminus: a
 * data store or an external service when it is infrastructure, otherwise an "ends here"
 * marker. Both are heuristics from names and layers and are marked as such.
 *
 * Bounded (MAX_LINES lines of at most MAX_STOPS stations) and deterministic: ties break on
 * the use metric, then the name, then the id.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { layerRank, type Provenance } from './layers';
import { stationOfRef, type Station, type StationModel } from './stations';

export const MAX_LINES = 8;
export const MAX_STOPS = 10;

export type Verdict = 'allowed' | 'same' | 'skips' | 'upward';

export interface LineHop {
    from: string;
    to: string;
    /** File-level references aggregated into this hop. */
    count: number;
    /** The worst layer verdict among them, when the pack gave any. */
    verdict?: Verdict;
}

export interface Terminus {
    kind: 'data' | 'external' | 'end';
    stationId: string;
    provenance: Provenance;
}

export interface Line {
    id: string;
    name: string;
    /** Index into the line palette (the surface cycles it). */
    colourIndex: number;
    stops: string[];
    hops: LineHop[];
    terminus: Terminus;
}

export interface LinesModel {
    lines: Line[];
    /** Station id → the ids of the lines that stop there (only stations on more than one). */
    interchanges: Map<string, string[]>;
    /** Entry points past MAX_LINES that were not given a line. */
    omitted: number;
}

const VERDICT_RANK: Record<Verdict, number> = { allowed: 0, same: 0, skips: 1, upward: 2 };
const EXTERNAL = /adapter|client|provider|gateway|http|\bapi\b|sdk|github|stripe|oauth|webhook|llm|mail|slack/i;

interface Edge { to: string; count: number; /** The worst verdict, for display on the hop. */ verdict?: Verdict; /** References per verdict (no verdict counts as allowed): the majority decides whether a line follows the hop. */ tally: Record<Verdict, number> }

/** The verdict most of a hop's file-level references carry; a tie reads as the milder one. */
function majorityVerdict(edge: Edge): Verdict {
    return (Object.keys(VERDICT_RANK) as Verdict[]).reduce((best, v) => (edge.tally[v] > edge.tally[best] || (edge.tally[v] === edge.tally[best] && VERDICT_RANK[v] < VERDICT_RANK[best]) ? v : best), 'allowed' as Verdict);
}

function stationEdges(graph: KnowledgeGraph, model: StationModel): Map<string, Map<string, Edge>> {
    const out = new Map<string, Map<string, Edge>>();
    for (const e of graph.edges) {
        if (e.kind !== 'references') continue;
        const a = stationOfRef(model, e.from), b = stationOfRef(model, e.to);
        if (!a || !b || a === b) continue;
        const row = out.get(a) ?? out.set(a, new Map()).get(a)!;
        const edge = row.get(b) ?? { to: b, count: 0, tally: { allowed: 0, same: 0, skips: 0, upward: 0 } };
        edge.count += 1;
        edge.tally[e.verdict ?? 'allowed'] += 1;
        if (e.verdict && (!edge.verdict || VERDICT_RANK[e.verdict] > VERDICT_RANK[edge.verdict])) edge.verdict = e.verdict;
        row.set(b, edge);
    }
    return out;
}

function terminusOf(station: Station | undefined, id: string): Terminus {
    if (station?.layer !== 'infrastructure') return { kind: 'end', stationId: id, provenance: 'heuristic' };
    return { kind: EXTERNAL.test(station.name) ? 'external' : 'data', stationId: id, provenance: 'heuristic' };
}

export function buildLines(graph: KnowledgeGraph, model: StationModel): LinesModel {
    const edges = stationEdges(graph, model);
    const entries = model.stations.filter((s) => s.entry);
    const lines: Line[] = [];

    for (const entry of entries.slice(0, MAX_LINES)) {
        const stops = [entry.id], hops: LineHop[] = [], seen = new Set(stops);
        while (stops.length < MAX_STOPS) {
            const here = model.byId.get(stops[stops.length - 1]!);
            const hereRank = layerRank(here?.layer);
            const next = [...(edges.get(stops[stops.length - 1]!)?.values() ?? [])]
                .filter((e) => {
                    if (seen.has(e.to) || majorityVerdict(e) === 'upward') return false;
                    const rank = layerRank(model.byId.get(e.to)?.layer);
                    return hereRank === undefined || rank === undefined || rank >= hereRank;
                })
                .sort((a, b) =>
                    b.count - a.count
                    || (model.byId.get(b.to)?.use ?? 0) - (model.byId.get(a.to)?.use ?? 0)
                    || cmp(model.byId.get(a.to)?.name ?? '', model.byId.get(b.to)?.name ?? '')
                    || cmp(a.to, b.to))[0];
            if (!next) break;
            hops.push({ from: stops[stops.length - 1]!, to: next.to, count: next.count, ...(next.verdict ? { verdict: next.verdict } : {}) });
            stops.push(next.to);
            seen.add(next.to);
        }
        const last = stops[stops.length - 1]!;
        lines.push({
            id: `line:${lines.length + 1}`, name: entry.name, colourIndex: lines.length, stops, hops,
            terminus: terminusOf(model.byId.get(last), last),
        });
    }

    const onLines = new Map<string, string[]>();
    for (const line of lines) for (const id of line.stops) (onLines.get(id) ?? onLines.set(id, []).get(id)!).push(line.id);
    const interchanges = new Map([...onLines].filter(([, ids]) => ids.length > 1));
    return { lines, interchanges, omitted: Math.max(0, entries.length - MAX_LINES) };
}
