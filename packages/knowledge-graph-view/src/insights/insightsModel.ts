/**
 * The insights model — PURE: what a graph says about its codebase, computed from the graph
 * alone (no model call). Headline metrics, composition, hotspots (fan-in / fan-out),
 * cross-partition coupling and findings by kind. Every list is sorted by value descending,
 * then by ref/id, so equal input gives equal output. Words are the panel's: the model carries
 * ids and numbers, plus the node labels that are data.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { labelFor, nodeIndex, partitionMatrix } from '../graphModel';
import { hotspotsOf, type Hotspot } from './hotspots';
import type { LensId } from '../types';

export const HOTSPOTS = 10;
export const COUPLING_PAIRS = 8;
/** Edge kinds that mean "depends on". */
const DEPENDS = new Set(['references', 'imports', 'links']);

export type MetricId =
    | 'files' | 'sections' | 'symbols' | 'edges' | 'findings' | 'errors' | 'warnings' | 'notes'
    | 'cycles' | 'violations' | 'cloneGroups' | 'duplicates' | 'unusedFiles' | 'unusedExports' | 'brokenLinks' | 'stale';

/** The lens that explains a metric — DATA, not branches. A metric absent here explains nothing more. */
export const METRIC_LENS: Partial<Record<MetricId, LensId>> = {
    cycles: 'partitions', violations: 'partitions', cloneGroups: 'duplication', duplicates: 'duplication',
    unusedFiles: 'unused', unusedExports: 'unused', brokenLinks: 'links', stale: 'knowledge',
};

export interface Metric { id: MetricId; value: number; lens?: LensId }

/** A chart row: `id` is the kind / partition / ref it counts, `text` a data label when the id is not words. */
export interface Bar { id: string; text?: string; value: number; refs: string[] }

export interface Insights {
    metrics: Metric[];
    kinds: Bar[];
    /** `partition` when any file is partitioned, else `area`. Ids are `''` for none. */
    composition: { by: 'partition' | 'area'; bars: Bar[] };
    fanIn: Bar[];
    fanOut: Bar[];
    coupling: Array<Bar & { from: string; to: string }>;
    findingKinds: Bar[];
}

const byValue = (a: { id: string; value: number }, b: { id: string; value: number }): number => b.value - a.value || cmp(a.id, b.id);

function tally(items: Iterable<{ id: string; ref: string }>): Bar[] {
    const m = new Map<string, string[]>();
    for (const { id, ref } of items) (m.get(id) ?? m.set(id, []).get(id)!).push(ref);
    return [...m.entries()].map(([id, refs]) => ({ id, value: refs.length, refs })).sort(byValue);
}

export function insightsOf(graph: KnowledgeGraph): Insights {
    const index = nodeIndex(graph);
    const nodes = graph.nodes;

    // ONE pass over the findings: the headline counts and the per-kind tally together.
    let errors = 0, warnings = 0, notes = 0, cycles = 0, violations = 0, cloneGroups = 0, brokenLinks = 0;
    const byKind = new Map<string, { count: number; nodes: Set<string> }>();
    for (const f of graph.findings) {
        if (f.severity === 'error') errors++; else if (f.severity === 'warn') warnings++; else if (f.severity === 'info') notes++;
        if (f.kind === 'cycle') cycles++;
        else if (f.kind === 'partition-violation' || f.kind === 'violation') violations++;
        else if (f.kind === 'clone-group') cloneGroups++;
        else if (f.kind === 'broken-link') brokenLinks += Number(f.params.count) || 1;
        let row = byKind.get(f.kind);
        if (!row) { row = { count: 0, nodes: new Set() }; byKind.set(f.kind, row); }
        row.count++;
        for (const ref of f.nodes) row.nodes.add(ref);
    }

    // ONE pass over the nodes: the counts, the kinds, and the files.
    let sections = 0, symbols = 0, duplicates = 0, unusedFiles = 0, unusedExports = 0, stale = 0;
    const files: KNode[] = [];
    const nodeKinds = new Map<string, string[]>();
    for (const n of nodes) {
        const isFile = n.kind === 'file';
        if (isFile) files.push(n);
        else if (n.kind === 'section') sections++;
        else if (n.kind === 'symbol' || n.kind === 'entity') symbols++;
        if (n.badges) {
            if (n.badges.cloneGroup !== undefined) duplicates++;
            if (isFile && n.badges.unused !== undefined) unusedFiles++;
            unusedExports += Number(n.badges.unusedExports) || 0;
        }
        if (n.stale) stale++;
        (nodeKinds.get(n.kind) ?? nodeKinds.set(n.kind, []).get(n.kind)!).push(n.ref);
    }

    const values: Record<MetricId, number> = {
        files: files.length, sections, symbols,
        edges: graph.edges.length,
        findings: graph.findings.length,
        errors, warnings, notes,
        cycles, violations, cloneGroups, duplicates, unusedFiles, unusedExports, brokenLinks, stale,
    };
    const metrics = (Object.keys(values) as MetricId[]).map((id) => ({ id, value: values[id], ...(METRIC_LENS[id] ? { lens: METRIC_LENS[id] } : {}) }));

    const partitioned = files.some((n) => n.partition !== undefined);
    const composition = {
        by: partitioned ? 'partition' as const : 'area' as const,
        bars: tally(files.map((n) => ({ id: (partitioned ? n.partition : n.area) ?? '', ref: n.ref }))).map((b) =>
            (partitioned || b.id === '' ? b : { ...b, text: labelFor(index, b.id) })),
    };

    // Distinct neighbours per node: two edge kinds between the same pair count once, so the bar's value is exactly the number of refs it opens.
    const hot = hotspotsOf(graph.edges, DEPENDS, HOTSPOTS);
    const hotspots = (list: readonly Hotspot[]): Bar[] => list.map((h) => ({ id: h.id, text: labelFor(index, h.id), value: h.value, refs: h.refs }));

    const { cells } = partitionMatrix(graph);
    const coupling = [...cells.entries()]
        .map(([key, cell]) => { const [from = '', to = ''] = key.split('\u0000'); return { id: key, from, to, value: cell.count }; })
        .filter((c) => c.from !== c.to)
        .sort(byValue).slice(0, COUPLING_PAIRS)
        .map((c) => ({ ...c, refs: nodes.filter((n) => n.partition === c.from || n.partition === c.to).map((n) => n.ref).sort() }));

    return {
        metrics,
        kinds: [...nodeKinds.entries()].map(([id, refs]) => ({ id, value: refs.length, refs })).sort(byValue),
        composition,
        fanIn: hotspots(hot.fanIn),
        fanOut: hotspots(hot.fanOut),
        coupling,
        findingKinds: [...byKind.entries()].map(([id, row]) => ({ id, value: row.count, refs: [...row.nodes].sort() })).sort(byValue),
    };
}
