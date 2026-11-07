/**
 * How ONE line is walked (PRD 38 Option B+, PRD 41 A9 rule 5): from its entry station down the layers
 * along `references`, always to the strongest unvisited next station, never climbing a layer and never
 * following an upward hop. When the walk stops it records WHY, computed from why the next-hop search
 * came up empty: nothing referenced, only upward hops, only stations already on the line, only
 * higher-layer stations, the stop cap, or a real terminus (a data store or an external service).
 * Ties break on the use metric, then the name, then the id, so the walk is deterministic.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { layerRank, type Provenance } from './layers';
import { stationOfRef, type Station, type StationModel } from './stations';

export const MAX_STOPS = 10;

export type Verdict = 'allowed' | 'same' | 'skips' | 'upward';

/** Why a line stops where it does. `terminus` is the only one that is a real end. */
export type StopReason = 'no-references' | 'only-upward' | 'only-visited' | 'only-higher-layer' | 'max-stops' | 'terminus';

export interface LineHop {
    from: string;
    to: string;
    /** File-level references aggregated into this hop. */
    count: number;
    /** The worst layer verdict among them, when the pack gave any. */
    verdict?: Verdict;
    /** Part of a dependency cycle: drawn with a non-colour mark. */
    cycle?: boolean;
}

export interface Terminus {
    kind: 'data' | 'external' | 'end';
    stationId: string;
    provenance: Provenance;
}

export interface Route {
    stops: string[];
    hops: LineHop[];
    stopReason: StopReason;
}

const VERDICT_RANK: Record<Verdict, number> = { allowed: 0, same: 0, skips: 1, upward: 2 };
const EXTERNAL = /adapter|client|provider|gateway|http|\bapi\b|sdk|github|stripe|oauth|webhook|llm|mail|slack/i;

export interface Edge { to: string; count: number; /** Any aggregated reference is a cycle, or the stations reference each other. */ cycle?: boolean; /** The worst verdict, for display on the hop. */ verdict?: Verdict; /** References per verdict (no verdict counts as allowed): the majority decides whether a line follows the hop. */ tally: Record<Verdict, number> }

/** The verdict most of a hop's file-level references carry; a tie reads as the milder one. */
function majorityVerdict(edge: Edge): Verdict {
    return (Object.keys(VERDICT_RANK) as Verdict[]).reduce((best, v) => (edge.tally[v] > edge.tally[best] || (edge.tally[v] === edge.tally[best] && VERDICT_RANK[v] < VERDICT_RANK[best]) ? v : best), 'allowed' as Verdict);
}

export function stationEdges(edges: readonly KEdge[], model: StationModel): Map<string, Map<string, Edge>> {
    const out = new Map<string, Map<string, Edge>>();
    for (const e of edges) {
        if (e.kind !== 'references') continue;
        const a = stationOfRef(model, e.from), b = stationOfRef(model, e.to);
        if (!a || !b || a === b) continue;
        const row = out.get(a) ?? out.set(a, new Map()).get(a)!;
        const edge = row.get(b) ?? { to: b, count: 0, tally: { allowed: 0, same: 0, skips: 0, upward: 0 } };
        edge.count += 1;
        edge.tally[e.verdict ?? 'allowed'] += 1;
        if (e.verdict && (!edge.verdict || VERDICT_RANK[e.verdict] > VERDICT_RANK[edge.verdict])) edge.verdict = e.verdict;
        if (e.cycle) edge.cycle = true;
        row.set(b, edge);
    }
    // Stations that reference each other are a cycle at the station level too.
    for (const [a, row] of out) for (const [b, edge] of row) if (out.get(b)?.has(a)) edge.cycle = true;
    return out;
}

export function terminusOf(station: Station | undefined, id: string): Terminus {
    if (station?.layer !== 'infrastructure') return { kind: 'end', stationId: id, provenance: 'heuristic' };
    return { kind: EXTERNAL.test(station.path ?? station.name) ? 'external' : 'data', stationId: id, provenance: 'heuristic' };
}

type Block = 'only-visited' | 'only-upward' | 'only-higher-layer';

/** Why a line may not follow this hop, or undefined when it may. Checked in this order. */
function blockOf(e: Edge, seen: ReadonlySet<string>, hereRank: number | undefined, model: StationModel): Block | undefined {
    if (seen.has(e.to)) return 'only-visited';
    if (majorityVerdict(e) === 'upward') return 'only-upward';
    const rank = layerRank(model.byId.get(e.to)?.layer);
    return hereRank === undefined || rank === undefined || rank >= hereRank ? undefined : 'only-higher-layer';
}

const strongest = (model: StationModel) => (a: Edge, b: Edge): number =>
    b.count - a.count
    || (model.byId.get(b.to)?.use ?? 0) - (model.byId.get(a.to)?.use ?? 0)
    || cmp(model.byId.get(a.to)?.name ?? '', model.byId.get(b.to)?.name ?? '')
    || cmp(a.to, b.to);

/** Walks the line that starts at `entryId`. */
export function followRoute(entryId: string, edges: ReadonlyMap<string, ReadonlyMap<string, Edge>>, model: StationModel): Route {
    const stops = [entryId], hops: LineHop[] = [], seen = new Set(stops);
    for (;;) {
        const at = stops[stops.length - 1]!;
        const hereRank = layerRank(model.byId.get(at)?.layer);
        const out = [...(edges.get(at)?.values() ?? [])].sort(strongest(model));
        const next = out.find((e) => blockOf(e, seen, hereRank, model) === undefined);
        if (next && stops.length >= MAX_STOPS) return { stops, hops, stopReason: 'max-stops' };
        if (!next) {
            const stopReason: StopReason = terminusOf(model.byId.get(at), at).kind !== 'end' ? 'terminus'
                : out.length === 0 ? 'no-references' : blockOf(out[0]!, seen, hereRank, model)!;
            return { stops, hops, stopReason };
        }
        hops.push({ from: at, to: next.to, count: next.count, ...(next.verdict ? { verdict: next.verdict } : {}), ...(next.cycle ? { cycle: true } : {}) });
        stops.push(next.to);
        seen.add(next.to);
    }
}
