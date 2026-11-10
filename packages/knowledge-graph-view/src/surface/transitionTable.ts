/**
 * The station transition table (PRD 38 P7): built ONCE per graph (and station map) and read by the path strip, Simulate
 * and "Run to end". The maths is memory's (`stationTransitions`, `transitionOf`, `mostLikelyWalk`); this module only
 * feeds it the stations' directed reference weights (`hopCountsOf`, the same pass the pinpoint path counts with) and the
 * station sequences of recorded runs when a host has them, and puts the result in words through `rateFormat`.
 *
 * Absent data is absent: no row for a station ⇒ no probability and no walk, never a guess.
 */

import {
    mostLikelyWalk, stationTransitions, transitionOf,
    type KnowledgeGraph, type StationTransition, type TransitionTable,
} from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { mapEdges } from './outlineGraph';
import { hopCountsOf } from './path';
import { rateFormat } from './rateFormat';
import type { Station, StationModel } from './stations';

export type { StationTransition, TransitionTable };

/** How far Simulate and "Run to end" follow the most likely walk. */
export const WALK_MAX_HOPS = 8;

/** Station-id sequences of recorded run traces, oldest first. */
export type StationSequences = ReadonlyArray<readonly string[]>;

const NO_SEQUENCES: StationSequences = [];

const tableMemo = new WeakMap<KnowledgeGraph, { stationOf: StationModel['stationOf']; sequences: StationSequences; table: TransitionTable }>();

/**
 * The transition table of a graph's stations, memoised on the graph: the same graph, station map and sequences give the
 * same table object. A station's row comes from the traces when they have a hop out of it, else from its references.
 */
export function transitionTableOf(graph: KnowledgeGraph, model: Pick<StationModel, 'stationOf'>, sequences: StationSequences = NO_SEQUENCES): TransitionTable {
    const held = tableMemo.get(graph);
    if (held && held.stationOf === model.stationOf && held.sequences === sequences) return held.table;
    const { weights } = hopCountsOf(model, mapEdges(graph));
    const table = stationTransitions(sequences.length > 0 ? { sequences, weights } : { weights });
    tableMemo.set(graph, { stationOf: model.stationOf, sequences, table });
    return table;
}

/** The hop from → to in the table; undefined when either end or the table is absent. */
export function hopTransition(table: TransitionTable | null | undefined, from: string | undefined, to: string | undefined): StationTransition | undefined {
    return table && from !== undefined && to !== undefined ? transitionOf(table, from, to) : undefined;
}

/** A hop's probability in words ("next ≈ 33% (9–71) · n = 3", "next 2 of 5 references"); null without a transition. */
export function hopProbabilityText(labels: KnowledgeGraphLabels, transition: StationTransition | undefined): string | null {
    return transition ? fillTemplate(labels.surface.transition.hop, { rate: rateFormat(labels, transition) }) : null;
}

export interface WalkHop {
    from: string;
    to: string;
    /** The station's name, else its id. */
    name: string;
    /** The hop's probability in words (`rateFormat`). */
    rate: string;
}

/** The most likely walk out of `start` (memory's `mostLikelyWalk`), each hop named and in words; [] when the station has no row. */
export function likelyWalk(
    table: TransitionTable,
    start: string,
    byId: ReadonlyMap<string, Pick<Station, 'name'>>,
    labels: KnowledgeGraphLabels,
    maxHops: number = WALK_MAX_HOPS,
): WalkHop[] {
    const { stops, hops } = mostLikelyWalk(table, start, maxHops);
    return hops.map((h, i) => ({ from: stops[i]!, to: h.to, name: byId.get(h.to)?.name ?? h.to, rate: rateFormat(labels, h) }));
}
