/**
 * The System camera's layout, pure (the System placement reads it): the tier rows (at most
 * MAX_PER_TIER marks each, the rest counted "+N more"), the stations in no layer (never placed),
 * and the stores, built from the same termini model the Map draws. Also the one colour each
 * finding kind gets (the lines panel's legend).
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';
import type { ThemeTone } from '../../scene/themeColors';
import type { LinesModel } from '../lines';
import type { Station, StationModel } from '../stations';
import { buildTiers } from '../tiers';
import { OTHER_LAYER } from '../transitLayout';
import { groupTermini, type TerminusInfo } from '../transit/termini';

/** Cards drawn in one tier; the rest sit behind a "+N more" card. */
export const MAX_PER_TIER = 6;

export interface TierRow {
    layer: string;
    /** Every station of the tier, busiest first. */
    stations: Station[];
    /** The cards drawn: the first MAX_PER_TIER. */
    shown: Station[];
    /** Stations behind the "+N more" card. */
    hidden: number;
}

export interface SystemLayout {
    tiers: TierRow[];
    /** Stations in no layer and on no line: counted in one row, not drawn. */
    notLayered: Station[];
    /** The data stores and external services the lines end in. */
    stores: TerminusInfo[];
}

export function buildSystemLayout(stations: StationModel, lines: LinesModel, graph: Pick<KnowledgeGraph, 'nodes'> | null): SystemLayout {
    const onLine = new Set(lines.lines.flatMap((l) => l.stops));
    const notLayered: Station[] = [];
    const tiers: TierRow[] = [];
    for (const tier of buildTiers(stations.stations)) {
        // An "other" station that a line stops at is part of the system's flow, so it keeps a card; the rest is only counted.
        const drawn = tier.layer === OTHER_LAYER ? tier.stations.filter((s) => onLine.has(s.id)) : tier.stations;
        if (tier.layer === OTHER_LAYER) notLayered.push(...tier.stations.filter((s) => !onLine.has(s.id)));
        if (drawn.length === 0) continue;
        tiers.push({ layer: tier.layer, stations: drawn, shown: drawn.slice(0, MAX_PER_TIER), hidden: Math.max(0, drawn.length - MAX_PER_TIER) });
    }
    return { tiers, notLayered, stores: groupTermini(lines.lines, stations.byId, graph).filter((t) => t.kind !== 'end') };
}

const KIND_TONES: readonly ThemeTone[] = ['violation', 'cycle', 'duplicate', 'contradicts', 'changed', 'nodeSymbol', 'nodeEntity', 'unused'];

/** One colour per finding kind, by the kinds' sorted order, so a bar segment and the rail legend agree. */
export function kindTones(kinds: Iterable<string>): Map<string, ThemeTone> {
    return new Map([...new Set(kinds)].sort(cmp).map((kind, i) => [kind, KIND_TONES[i % KIND_TONES.length]!] as const));
}
