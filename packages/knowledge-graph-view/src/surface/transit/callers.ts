import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';
import type { SymbolRecord } from '../../types';
import { mapEdges } from '../outlineGraph';
import { fileRefOf } from '../stations';

/** Immediate incoming calls; use file references for old snapshots where no incoming calls were indexed. */
export function callersOf(graph: KnowledgeGraph, records: readonly SymbolRecord[], refs: readonly string[]): string[] {
    const exact = new Set(refs.filter((ref) => fileRefOf(ref) !== ref).map((ref) => ref.replace(/@\d+$/, '')));
    const files = new Set(refs.filter((ref) => fileRefOf(ref) === ref));
    const matches = (ref: string) => exact.has(ref.replace(/@\d+$/, '')) || files.has(fileRefOf(ref));
    const incoming = new Set<string>();
    for (const edge of graph.edges) if (edge.kind === 'calls' && matches(edge.to) && !matches(edge.from)) incoming.add(edge.from);
    for (const record of records) {
        if (!matches(record.ref) && record.relations?.some((edge) => edge.kind === 'calls' && matches(edge.to))) incoming.add(record.ref);
    }
    if (incoming.size === 0 && files.size) {
        for (const e of mapEdges(graph)) if (e.kind === 'references' && files.has(fileRefOf(e.to)) && !matches(e.from)) incoming.add(e.from);
    }
    return [...incoming].sort(cmp);
}
