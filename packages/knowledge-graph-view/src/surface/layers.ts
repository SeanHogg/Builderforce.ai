/**
 * The five layers a code file is placed in (PRD 38 contract 2), top to bottom. Every layer
 * reading in the surface (the transit map's bands, "downward" in a line) goes through this
 * one table.
 */

export const LAYER_ORDER = ['entry', 'presentation', 'application', 'domain', 'infrastructure'] as const;
export type Layer = (typeof LAYER_ORDER)[number];

/** A partition's depth (0 = entry), or undefined for a partition that is not one of the five. */
export function layerRank(partition: string | undefined): number | undefined {
    const at = LAYER_ORDER.indexOf(partition as Layer);
    return at < 0 ? undefined : at;
}

/** Where a metric or a finding comes from (PRD 38: deterministic unless marked). */
export type Provenance = 'deterministic' | 'heuristic' | 'runtime';
