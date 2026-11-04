/**
 * The insights model — PURE: what a graph says about its codebase, computed from the graph
 * alone (no model call). Headline metrics, composition, hotspots (fan-in / fan-out),
 * cross-partition coupling and findings by kind. Every list is sorted by value descending,
 * then by ref/id, so equal input gives equal output. Words are the panel's: the model carries
 * ids and numbers, plus the node labels that are data.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { labelFor, nodeIndex, partitionMatrix } from '../graphModel';
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
    const isFile = (kind: string): boolean => kind === 'file';
    const count = (kinds: readonly string[]): number => graph.findings.filter((f) => kinds.includes(f.kind)).length;
    const sumBadge = (key: string): number => nodes.reduce((n, x) => n + (Number(x.badges?.[key]) || 0), 0);
    const sumParam = (kinds: readonly string[]): number =>
        graph.findings.filter((f) => kinds.includes(f.kind)).reduce((n, f) => n + (Number(f.params.count) || 1), 0);
    const severity = (s: 'error' | 'warn' | 'info'): number => graph.findings.filter((f) => f.severity === s).length;

    const values: Record<MetricId, number> = {
        files: nodes.filter((n) => isFile(n.kind)).length,
        sections: nodes.filter((n) => n.kind === 'section').length,
        symbols: nodes.filter((n) => n.kind === 'symbol' || n.kind === 'entity').length,
        edges: graph.edges.length,
        findings: graph.findings.length,
        errors: severity('error'), warnings: severity('warn'), notes: severity('info'),
        cycles: count(['cycle']),
        violations: count(['partition-violation', 'violation']),
        cloneGroups: count(['clone-group']),
        duplicates: nodes.filter((n) => n.badges?.cloneGroup !== undefined).length,
        unusedFiles: nodes.filter((n) => isFile(n.kind) && n.badges?.unused !== undefined).length,
        unusedExports: sumBadge('unusedExports'),
        brokenLinks: sumParam(['broken-link']),
        stale: nodes.filter((n) => n.stale).length,
    };
    const metrics = (Object.keys(values) as MetricId[]).map((id) => ({ id, value: values[id], ...(METRIC_LENS[id] ? { lens: METRIC_LENS[id] } : {}) }));

    const files = nodes.filter((n) => isFile(n.kind));
    const partitioned = files.some((n) => n.partition !== undefined);
    const composition = {
        by: partitioned ? 'partition' as const : 'area' as const,
        bars: tally(files.map((n) => ({ id: (partitioned ? n.partition : n.area) ?? '', ref: n.ref }))).map((b) =>
            (partitioned || b.id === '' ? b : { ...b, text: labelFor(index, b.id) })),
    };

    // Distinct neighbours per node: two edge kinds between the same pair count once, so the bar's value is exactly the number of refs it opens.
    const incoming = new Map<string, Set<string>>(), outgoing = new Map<string, Set<string>>();
    const add = (m: Map<string, Set<string>>, key: string, other: string): void => { (m.get(key) ?? m.set(key, new Set()).get(key)!).add(other); };
    for (const e of graph.edges) {
        if (!DEPENDS.has(e.kind) || e.from === e.to) continue;
        add(incoming, e.to, e.from);
        add(outgoing, e.from, e.to);
    }
    const hotspots = (m: Map<string, Set<string>>): Bar[] =>
        [...m.entries()].map(([id, others]) => ({ id, text: labelFor(index, id), value: others.size, refs: [...others].sort(cmp) }))
            .sort(byValue).slice(0, HOTSPOTS);

    const { cells } = partitionMatrix(graph);
    const coupling = [...cells.entries()]
        .map(([key, cell]) => { const [from = '', to = ''] = key.split('\u0000'); return { id: key, from, to, value: cell.count }; })
        .filter((c) => c.from !== c.to)
        .sort(byValue).slice(0, COUPLING_PAIRS)
        .map((c) => ({ ...c, refs: nodes.filter((n) => n.partition === c.from || n.partition === c.to).map((n) => n.ref).sort() }));

    return {
        metrics,
        kinds: tally(nodes.map((n) => ({ id: n.kind, ref: n.ref }))),
        composition,
        fanIn: hotspots(incoming),
        fanOut: hotspots(outgoing),
        coupling,
        findingKinds: tally(graph.findings.map((f) => ({ id: f.kind, ref: f.id }))).map((b) => ({
            ...b, refs: [...new Set(graph.findings.filter((f) => f.kind === b.id).flatMap((f) => f.nodes))].sort(),
        })),
    };
}
