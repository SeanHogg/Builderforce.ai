/**
 * The N-tier reading of the stations: one row per layer (entry to infrastructure, then
 * "other"), the stations of a row busiest first. The System camera draws the rows as cards,
 * the Heat camera as cells; both read this one grouping. Also the two small readings a card
 * carries: its findings by kind. (The data / external termini come from `transit/termini`, the
 * model the transit map draws, so the two cameras cannot disagree.)
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { LAYER_ORDER } from './layers';
import type { Station } from './stations';
import { OTHER_LAYER } from './transitLayout';

export interface Tier { layer: string; stations: Station[] }

const layerOf = (s: Station): string => (s.layer && (LAYER_ORDER as readonly string[]).includes(s.layer) ? s.layer : OTHER_LAYER);

/** Rows with at least one station, in layer order; a row's stations by usage, then name. */
export function buildTiers(stations: readonly Station[]): Tier[] {
    const rows = new Map<string, Station[]>();
    for (const s of stations) (rows.get(layerOf(s)) ?? rows.set(layerOf(s), []).get(layerOf(s))!).push(s);
    return [...LAYER_ORDER, OTHER_LAYER]
        .filter((layer) => rows.has(layer))
        .map((layer) => ({ layer, stations: rows.get(layer)!.sort((a, b) => b.use - a.use || cmp(a.name, b.name) || cmp(a.id, b.id)) }));
}

export interface KindCount { kind: string; count: number }

/** The station's findings counted by kind, most first (ties by kind). */
export function findingKinds(station: Pick<Station, 'findingIds'>, findings: ReadonlyMap<string, Finding>): KindCount[] {
    const counts = new Map<string, number>();
    for (const id of station.findingIds) {
        const f = findings.get(id);
        if (f) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    }
    return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || cmp(a.kind, b.kind));
}
