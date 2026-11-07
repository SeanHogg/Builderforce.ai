/**
 * The small texts the path strip hangs on a stop: a station's one-line note ("no tests · god")
 * from its metrics and patterns, and the entry a line begins at (its first route, else the
 * entry station's name). Pure, so the strip only draws them.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import { counted } from './plural';
import type { Station } from './stations';

/** Below this mean coverage a station reads as "no tests" (the same line the Untested question draws). */
export const UNTESTED_BELOW = 0.5;

/** "no tests · god · 2 findings": only what is true of the station, joined; null when nothing is. */
export function stationNote(st: Station | undefined, labels: KnowledgeGraphLabels): string | null {
    if (!st) return null;
    const t = labels.surface.path;
    const parts: string[] = [];
    if (st.cov !== undefined && st.cov < UNTESTED_BELOW) parts.push(t.noTests);
    if (st.patterns[0]) parts.push(st.patterns[0]);
    if (st.findingIds.length > 0) parts.push(counted(labels, 'finding', st.findingIds.length));
    return parts.length > 0 ? parts.join(' · ') : null;
}

/** The first HTTP route (`GET /users/:id`) of the station's files; '' when none (the line's own name says the rest). */
export function entryRoute(graph: Pick<KnowledgeGraph, 'nodes'>, station: Pick<Station, 'refs'> | undefined): string {
    if (!station) return '';
    const refs = new Set(station.refs);
    for (const n of graph.nodes) {
        if (!refs.has(n.ref)) continue;
        const first = String(n.badges?.routes ?? '').split(';').map((r) => r.trim()).find((r) => r !== '');
        if (first) return first;
    }
    return '';
}

/** The first HTTP route of the station's files, else the station's own name. */
export function entryLabel(graph: Pick<KnowledgeGraph, 'nodes'>, station: Pick<Station, 'name' | 'refs'> | undefined): string {
    return station ? entryRoute(graph, station) || station.name : '';
}
