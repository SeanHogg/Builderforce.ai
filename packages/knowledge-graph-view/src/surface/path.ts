/**
 * The two small pure readings the chrome shows: the PATH of a line (its stops with the edge
 * between each pair, for the path strip) and the SPINE (the drill path station › file ›
 * symbol, for the header). A later trace or sequence feeds the same `PathModel`.
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fileRefOf, stationOfRef, type Station, type StationModel } from './stations';
import type { Line } from './lines';

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
    const ids: string[] = [];
    for (const ref of refs) {
        const id = stationOfRef(model, ref);
        if (id && !ids.includes(id)) ids.push(id);
    }
    const stops = ids.flatMap((id) => {
        const s = model.byId.get(id);
        return s ? [{ id, name: s.name, ...(s.layer ? { layer: s.layer } : {}) }] : [];
    });
    const between = (a: string, b: string) => edges.filter((e) => {
        if (e.kind !== 'references') return false;
        const from = stationOfRef(model, e.from), to = stationOfRef(model, e.to);
        return (from === a && to === b) || (from === b && to === a);
    }).length;
    return { stops, hops: stops.slice(1).map((s, i) => ({ kind: 'references', count: between(stops[i]!.id, s.id) })) };
}

export interface SpineItem {
    kind: 'root' | 'line' | 'station' | 'file' | 'symbol';
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
