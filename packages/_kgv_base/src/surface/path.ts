/**
 * The two small pure readings the chrome shows: the PATH of a line (its stops with the edge
 * between each pair, for the path strip) and the SPINE (the drill path station › file ›
 * symbol, for the header). A later trace or sequence feeds the same `PathModel`.
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fileRefOf, stationOfRef, type Station, type StationModel } from './stations';
import type { Line } from './lines';
import { pairKey, PAIR_SPAN, unorderedPairKey } from '../pairKey';

export interface PathStop { id: string; name: string; layer?: string }
export interface PathHop {
    kind: string;
    count: number;
    verdict?: string;
    /** Part of a dependency cycle: marked with a glyph and the cycle label, never by colour alone. */
    cycle?: boolean;
    /** What travels over the hop (a payload, a route), when the edge carries it; drawn after the kind on the path strip. */
    detail?: string;
}
export interface PathModel { stops: PathStop[]; hops: PathHop[] }

export const EMPTY_PATH: PathModel = { stops: [], hops: [] };

export function pathOfLine(line: Line | null, byId: ReadonlyMap<string, Station>): PathModel {
    if (!line) return EMPTY_PATH;
    const stops = line.stops.flatMap((id) => {
        const s = byId.get(id);
        return s ? [{ id, name: s.name, ...(s.layer ? { layer: s.layer } : {}) }] : [];
    });
    return { stops, hops: line.hops.map((h) => ({ kind: 'references', count: h.count, ...(h.verdict ? { verdict: h.verdict } : {}), ...(h.cycle ? { cycle: true } : {}) })) };
}

type HopCounts = ReadonlyMap<number, number>;

/** A directed reference weight between two stations: how many file-level `references` run from → to. */
export interface StationWeight { from: string; to: string; weight: number }

// A station-pair hop count is keyed by `unorderedPairKey` of the two station numbers (a hop counts both directions); the
// directed weights (the transition table's input, PRD 38 P7) by `pairKey` of the same numbers, in the same pass.

interface HopCountsBuilt { stationOf: StationModel['stationOf']; counts: HopCounts; slots: ReadonlyMap<string, number>; weights: readonly StationWeight[] }

const hopCountsMemo = new WeakMap<readonly Pick<KEdge, 'from' | 'to' | 'kind'>[], HopCountsBuilt>();

/**
 * The `references` between every pair of stations, counted ONCE per edges array (and station map): a pinpoint then reads
 * each hop in O(1) instead of scanning every outline edge per hop. `weights` keeps the direction (from → to).
 */
export function hopCountsOf(model: Pick<StationModel, 'stationOf'>, edges: readonly Pick<KEdge, 'from' | 'to' | 'kind'>[]): Omit<HopCountsBuilt, 'stationOf'> {
    const held = hopCountsMemo.get(edges);
    if (held && held.stationOf === model.stationOf) return held;
    const slots = new Map<string, number>();
    const ids: string[] = [];
    const slotOf = (id: string): number => { let n = slots.get(id); if (n === undefined) { n = slots.size; slots.set(id, n); ids.push(id); } return n; };
    const counts = new Map<number, number>();
    const directed = new Map<number, number>();
    for (const e of edges) {
        if (e.kind !== 'references') continue;
        const from = stationOfRef(model, e.from);
        if (from === undefined) continue;
        const to = stationOfRef(model, e.to);
        if (to === undefined || from === to) continue;
        const a = slotOf(from), b = slotOf(to);
        const key = unorderedPairKey(a, b);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const dkey = pairKey(a, b);
        directed.set(dkey, (directed.get(dkey) ?? 0) + 1);
    }
    const weights = [...directed].map(([key, weight]) => ({ from: ids[Math.floor(key / PAIR_SPAN)]!, to: ids[key % PAIR_SPAN]!, weight }));
    const built = { stationOf: model.stationOf, counts, slots, weights };
    hopCountsMemo.set(edges, built);
    return built;
}

/**
 * A path through the stations of `refs`, in the order given (a pinpoint's matches arrive in
 * trace order): each station once, and between two neighbours the file-level references that
 * run between them in either direction. Refs that fall in no station are left out.
 */
export function pathOfStations(
    refs: readonly string[],
    model: Pick<StationModel, 'byId' | 'stationOf'>,
    edges: readonly Pick<KEdge, 'from' | 'to' | 'kind'>[],
): PathModel {
    const picked = new Set<string>();
    const ids: string[] = [];
    for (const ref of refs) {
        const id = stationOfRef(model, ref);
        if (id && !picked.has(id)) { picked.add(id); ids.push(id); }
    }
    const stops = ids.flatMap((id) => {
        const s = model.byId.get(id);
        return s ? [{ id, name: s.name, ...(s.layer ? { layer: s.layer } : {}) }] : [];
    });
    if (stops.length < 2) return { stops, hops: [] };
    const { counts, slots } = hopCountsOf(model, edges);
    const between = (a: string, b: string): number => {
        const x = slots.get(a), y = slots.get(b);
        return x === undefined || y === undefined ? 0 : counts.get(unorderedPairKey(x, y)) ?? 0;
    };
    return { stops, hops: stops.slice(1).map((s, i) => ({ kind: 'references', count: between(stops[i]!.id, s.id) })) };
}

export interface SpineItem {
    kind: 'root' | 'system' | 'line' | 'station' | 'file' | 'symbol';
    /** The station id or node ref this crumb selects (the root and the line have none). */
    id?: string;
    label: string;
}

export interface SpineInput {
    rootTitle: string;
    station: Station | null;
    node: KNode | null;
    nodeLabel(ref: string): string;
}

/**
 * Puts the drawn line's crumb ("VS Code line") right after the root: root › line › station. No label ⇒ the items
 * unchanged. Picking it goes back up to the line (`selectStation(null)`). Applied to `buildSpine`'s items.
 */
export function withLineCrumb(items: readonly SpineItem[], line: string | null | undefined): SpineItem[] {
    if (!line) return [...items];
    const [root, ...rest] = items;
    return root ? [root, { kind: 'line', label: line }, ...rest] : [{ kind: 'line', label: line }];
}

/**
 * A root of several systems starts its crumb at the system (PRD 41 A9): root › system › line › station. No name ⇒ the items
 * unchanged. Picking it steps back up to the line list like the line crumb. Applied after `withLineCrumb`.
 */
export function withSystemCrumb(items: readonly SpineItem[], system: string | null | undefined): SpineItem[] {
    if (!system) return [...items];
    const [root, ...rest] = items;
    return root ? [root, { kind: 'system', label: system }, ...rest] : [{ kind: 'system', label: system }];
}

/** station › file › symbol under the reviewed folder; absent levels are left out (the line crumb is `withLineCrumb`). */
export function buildSpine({ rootTitle, station, node, nodeLabel }: SpineInput): SpineItem[] {
    const items: SpineItem[] = [{ kind: 'root', label: rootTitle }];
    if (station) items.push({ kind: 'station', id: station.id, label: station.name });
    if (!node) return items;
    if (node.kind === 'symbol') {
        const file = fileRefOf(node.ref);
        if (file !== node.ref) items.push({ kind: 'file', id: file, label: nodeLabel(file) });
        items.push({ kind: 'symbol', id: node.ref, label: node.label });
    } else {
        items.push({ kind: 'file', id: node.ref, label: node.label });
    }
    return items;
}
