/**
 * The 4+1 coverage map (Kruchten's 4+1 view model): there is no "4+1" camera on the stage — each of the five aspects is
 * read by cameras that already exist. This is the table of which camera, at which semantic-zoom band (PRD 43 B1a rule 9),
 * shows each aspect, with what it reads, and the gap where the data is not there yet. Pure data; the test holds every
 * aspect to at least one camera registered in `PLACEMENTS`, and runs each row's `probe` over a graph shaped as the code
 * pack writes it, so a row cannot claim data the graph does not carry.
 *
 * (The DOM `surface/FourPlusOneCamera.tsx` — Logical = System tiers, Development = Mind map, Process = Sequence,
 * Physical = `fourPlusOne/PhysicalView.tsx`, Scenarios = `fourPlusOne/ScenariosView.tsx` — retires at make-default.)
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { concurrencyOf, deployBindingsOf, deployUnitsOf } from './deployFacts';
import type { PlacementCamera } from './stage/types';

export type FourPlusOneAspect = 'logical' | 'development' | 'process' | 'physical' | 'scenarios';
export const FOUR_PLUS_ONE_ASPECTS: readonly FourPlusOneAspect[] = ['logical', 'development', 'process', 'physical', 'scenarios'];

/** The semantic-zoom band a camera shows the aspect at (B1a rule 9); `any` = not band-dependent. */
export type ZoomBand = 'system' | 'class' | 'method' | 'code' | 'any';

export interface AspectCoverage {
    camera: PlacementCamera;
    band: ZoomBand;
    /** What the camera reads that answers the aspect (the model it is built from). */
    reads: string;
    /** How many graph facts the row reads, where it reads a fact the extractor writes (`deployFacts.ts`). */
    probe?: (graph: Pick<KnowledgeGraph, 'nodes'>) => number;
}

export interface AspectEntry {
    coverage: readonly AspectCoverage[];
    /** What is not visualised yet; null = fully covered. */
    gap: string | null;
}

export const FOUR_PLUS_ONE_COVERAGE: Readonly<Record<FourPlusOneAspect, AspectEntry>> = {
    logical: {
        coverage: [
            { camera: 'graph', band: 'any', reads: 'nodes by partition, references edges (layout2d)' },
            { camera: 'map', band: 'class', reads: 'semantic zoom class band: classes and their associations (B1a rule 9, P1b)' },
            { camera: 'system', band: 'system', reads: 'components tier by tier (buildSystemLayout)' },
        ],
        gap: 'Class composition / association edges (extends, implements, composes, uses) are not emitted by builderforce-memory yet (PRD 43 P0b); until then the class band shows classes without those links.',
    },
    development: {
        coverage: [
            { camera: 'map', band: 'system', reads: 'stations (folders / areas) in layer bands (layoutTransit)' },
            { camera: 'system', band: 'system', reads: 'tiers per layer, one section per system (buildSystemGroups)' },
            { camera: 'mind', band: 'any', reads: 'the folder tree (parentFolder slots)' },
            { camera: 'style', band: 'any', reads: 'source files per layer under the style verdict (architectureStyleOf)' },
        ],
        gap: null,
    },
    process: {
        coverage: [
            { camera: 'sequence', band: 'system', reads: 'the selected line as messages between stations (sequenceModel)' },
            { camera: 'sequence', band: 'method', reads: 'calls in call-site order (B1a rule 10, needs P0b calls edges)' },
            {
                camera: 'system', band: 'system',
                reads: 'concurrency per file: the `concurrency` badge (worker threads, queue producers / consumers, Durable Objects, cron handlers, pollers; deployFacts concurrencyOf)',
                probe: (g) => concurrencyOf(g).length,
            },
        ],
        gap: 'Concurrency is a file badge, not yet drawn as its own decoration on the station mark; method-band call order needs the P0b `calls` edges.',
    },
    physical: {
        coverage: [
            {
                camera: 'system', band: 'system',
                reads: 'deployable units from deploy descriptors (entity nodes `type: deployable-unit`: container, worker, function, service, cli, workflow; deployFacts deployUnitsOf) beside the systems (buildSystemGroups)',
                probe: (g) => deployUnitsOf(g).length,
            },
            {
                camera: 'system', band: 'system',
                reads: 'the stores plane: data stores / external services the lines end in (groupTermini) and the bindings units declare (KV, D1, R2, queues, Durable Objects; deployFacts deployBindingsOf)',
                probe: (g) => deployBindingsOf(g).length,
            },
            { camera: 'map', band: 'system', reads: 'line termini drawn as data-store and external-service ends (groupTermini)' },
        ],
        gap: 'Units and bindings are on the graph but have no MarkSet slot yet: the System placement draws only station marks, so its stores plane shows termini, not the units (needs a system/package slot kind in the MarkSet and a units row in the System placement).',
    },
    scenarios: {
        coverage: [
            { camera: 'sequence', band: 'system', reads: 'each line from an entry point to where it ends (buildLines)' },
            { camera: 'features', band: 'any', reads: 'capabilities, API endpoints and entry points (keyFeaturesOf)' },
            { camera: 'map', band: 'system', reads: 'the lines themselves, entry to terminus (buildLines)' },
        ],
        gap: null,
    },
};
