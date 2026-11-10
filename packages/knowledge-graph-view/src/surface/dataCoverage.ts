/**
 * How much of the data the picture needs the graph actually carries, and WHY a channel is empty.
 * The ONE computation: the map's notice, every "Not set up" reason line and the copied
 * diagnostics all read it, so they can never disagree.
 *
 * Where the map's files come from matters: a graph the server cut carries an `outline` (every
 * file) on a current server; an older server sends none, so the map falls back to the cut graph's
 * few files, which carry no per-file badges either. A channel with no data reads as "Not set up"
 * (never zero); this says which of the three causes it is: no outline, no file carries badges (the
 * review predates the per-file extractor), or the data was not collected (e.g. no coverage file).
 */

import type { KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { MetricId } from './overlays';
import { fileNodesOf, outlineView } from './outlineGraph';
import { staticReach } from './staticReach';
import { isCommunityKey, placementKeyOf } from '../placement';

/** The per-file badges the channels, questions and lines read. */
export const COVERAGE_KEYS = ['complexity', 'coverage', 'churn', 'owner', 'patterns', 'routes', 'layerRule', 'externals'] as const;
export type CoverageKey = (typeof COVERAGE_KEYS)[number];

/** Badges the per-file extractor writes: a file with none of them predates it. */
const EXTRACTOR_KEYS: readonly string[] = [...COVERAGE_KEYS, 'maxComplexity', 'cloneGroup', 'unused', 'unusedExports', 'unusedDependencies'];

export type GapReason = 'no-outline' | 'no-badges' | 'not-collected';

export type MapSource =
    | { kind: 'outline'; files: number; capped: boolean }
    /** The server sent no outline (older than the outline release): the map shows the cut graph's `files` of `sources`. */
    | { kind: 'cut'; files: number; sources: number }
    | { kind: 'full'; files: number };

export interface ChannelCoverage {
    key: CoverageKey;
    /** Files that carry the badge, of `of` files the map reads. */
    have: number;
    of: number;
    /**
     * No file carries the badge, but the channel still has a reading: coverage falls back to the static reach of the test
     * files (a heuristic, provenance "reached"). Only ever true for `coverage`.
     */
    reached: boolean;
    /** Why the channel has no data at all; null while any file has the badge or the reach fallback applies. */
    reason: GapReason | null;
}

export interface DataCoverage {
    source: MapSource;
    /** Files the map reads, and sources the review saw. */
    files: number;
    sources: number;
    /** Files carrying any extractor badge. */
    badged: number;
    /** Files with no placement: no partition and no community (PRD 38 P1 accepts at most 5%). */
    noPartition: number;
    /** Files placed by their community (no pack partition, a `communityId` badge). */
    byCommunity: number;
    channels: Record<CoverageKey, ChannelCoverage>;
}

/** The badge a metric reads; anti-patterns, usage and changed are always computable (no badge). */
export const METRIC_KEY: Partial<Record<MetricId, CoverageKey>> = { cx: 'complexity', cov: 'coverage', churn: 'churn', owner: 'owner' };

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

const cache = new WeakMap<KnowledgeGraph, DataCoverage>();

function mapSourceOf(graph: KnowledgeGraph): MapSource {
    const view = outlineView(graph);
    if (view) return { kind: 'outline', files: view.files.length, capped: view.capped };
    const files = fileNodesOf(graph).length;
    return graph.stats.truncated && !graph.outline ? { kind: 'cut', files, sources: graph.stats.sources } : { kind: 'full', files };
}

/** Files with no placement, and files placed by their community, in one pass. */
function placementCounts(files: readonly KNode[]): { noPartition: number; byCommunity: number } {
    let noPartition = 0, byCommunity = 0;
    for (const n of files) {
        const key = placementKeyOf(n);
        if (!key) noPartition++;
        else if (isCommunityKey(key)) byCommunity++;
    }
    return { noPartition, byCommunity };
}

export function dataCoverage(graph: KnowledgeGraph): DataCoverage {
    const hit = cache.get(graph);
    if (hit) return hit;
    const files: KNode[] = fileNodesOf(graph);
    const source = mapSourceOf(graph);
    const badged = files.filter((n) => EXTRACTOR_KEYS.some((k) => present(n.badges?.[k]))).length;
    const reasonFor = (): GapReason => (source.kind === 'cut' ? 'no-outline' : badged === 0 ? 'no-badges' : 'not-collected');
    const channels = Object.fromEntries(COVERAGE_KEYS.map((key) => {
        const have = files.filter((n) => present(n.badges?.[key])).length;
        // The ONE rule for "this channel has data": a badge on some file, or (coverage only) the static reach of the test files.
        const reached = key === 'coverage' && have === 0 && staticReach(graph) !== null;
        return [key, { key, have, of: files.length, reached, reason: have === 0 && !reached ? reasonFor() : null }] as const;
    })) as Record<CoverageKey, ChannelCoverage>;
    const result: DataCoverage = {
        source, files: files.length, sources: graph.stats.sources, badged,
        ...placementCounts(files), channels,
    };
    cache.set(graph, result);
    return result;
}

/** Whether any file carries a measured coverage badge (no badge means the stations fall back to static reach, or to no reading). */
export const hasMeasuredCoverage = (coverage: DataCoverage): boolean => coverage.channels.coverage.have > 0;

/** Why a metric has no data; null when it has some (or needs none). */
export function gapOf(coverage: DataCoverage, metric: MetricId): GapReason | null {
    const key = METRIC_KEY[metric];
    return key ? coverage.channels[key].reason : null;
}
