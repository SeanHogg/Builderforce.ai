/**
 * The N-tier reading of the stations: one row per layer (entry to infrastructure, then
 * "other"), the stations of a row busiest first. The System and Heat placements both read
 * this one grouping. (The data / external termini come from `transit/termini`, the model the
 * Map draws, so the cameras cannot disagree.)
 */

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
