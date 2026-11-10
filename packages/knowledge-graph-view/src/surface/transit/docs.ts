/**
 * Documents on the map. A station made of docs-pack files is a document station (drawn in the doc type's silhouette),
 * and a link, mention or claim between a document station and a code station is a "describes"
 * link (drawn dashed from the document to the code). The Claims question lights them. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex } from '../../graphModel';
import { cmp } from '../../order';
import { stationOfRef, type StationModel } from '../stations';

export interface DescribeLink { from: string; to: string; count: number }

const DESCRIBING = new Set(['links', 'mentions', 'about', 'references']);

/** The stations whose files are mostly docs-pack files. */
export function docStations(graph: Pick<KnowledgeGraph, 'nodes'>, model: StationModel): Set<string> {
    const index = nodeIndex(graph);
    const out = new Set<string>();
    for (const s of model.stations) {
        const docs = s.refs.filter((r) => index.get(r)?.pack === 'docs').length;
        if (s.refs.length > 0 && docs * 2 > s.refs.length) out.add(s.id);
    }
    return out;
}

/** Document station → code station, once per pair, with how many references say so. */
export function describesLinks(graph: Pick<KnowledgeGraph, 'edges'>, model: StationModel, docs: ReadonlySet<string>): DescribeLink[] {
    if (docs.size === 0) return [];
    const counts = new Map<string, DescribeLink>();
    for (const e of graph.edges) {
        if (!DESCRIBING.has(e.kind)) continue;
        const a = stationOfRef(model, e.from), b = stationOfRef(model, e.to);
        if (!a || !b || a === b) continue;
        const docFirst = docs.has(a) && !docs.has(b), docSecond = docs.has(b) && !docs.has(a);
        if (!docFirst && !docSecond) continue;
        const from = docFirst ? a : b, to = docFirst ? b : a;
        const key = `${from}>${to}`;
        const have = counts.get(key);
        if (have) have.count += 1; else counts.set(key, { from, to, count: 1 });
    }
    return [...counts.values()].sort((p, q) => cmp(p.from, q.from) || cmp(p.to, q.to));
}
