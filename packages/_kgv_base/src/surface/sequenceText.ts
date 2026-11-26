/**
 * The words of a path as a sequence: one message per hop ("references · 3", or "no direct
 * reference") and the Mermaid text of exactly that. ONE place, so the Sequence camera, the path
 * strip's *Copy as Mermaid* and its stop chips can never disagree.
 */

import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { formatBytes } from '../formatBytes';
import type { KnowledgeGraphLabels } from '../labels';
import { fillTemplate } from '../template';
import { edgeKindLabel } from '../names';
import type { PathHop, PathModel } from './path';
import { sequenceOf, toSequenceMermaid } from './sequenceModel';
import type { Station } from './stations';

/** A hop in words: the edge kind and how many references make it, or that there is none. */
export function hopText(labels: KnowledgeGraphLabels, hop: PathHop): string {
    const s = labels.surface;
    const words = hop.count === 0 ? s.noDirectReference : fillTemplate(s.pathHop, { kind: edgeKindLabel(labels, hop.kind), count: hop.count });
    return hop.cycle ? `${words} · ${s.cycleHop}` : words;
}

/**
 * The label of one hop, from facts only: the first route badge of the files the hop enters
 * (`routes`: "PUT /orders/:id; GET /orders") and the largest `payloadBytes` badge among them.
 * "PUT 1.4 MB" with both, the whole route ("PUT /orders/:id") with only the route, the size alone
 * with only the payload, and null when neither is known. Never a guess.
 */
export function hopRouteLabel(files: readonly Pick<KNode, 'badges'>[]): string | null {
    let route: string | undefined;
    let bytes = 0;
    for (const f of files) {
        route ??= String(f.badges?.routes ?? '').split(';').map((r) => r.trim()).find((r) => r !== '');
        const b = Number(f.badges?.payloadBytes);
        if (Number.isFinite(b) && b > bytes) bytes = b;
    }
    const method = route?.match(/^([A-Z]{3,7})\s/)?.[1];
    if (bytes > 0) return method ? `${method} ${formatBytes(bytes)}` : formatBytes(bytes);
    return route ?? null;
}

/** The route label per hop of a path (the files of the stop each hop enters), indexed like `path.hops`. */
export function hopRouteLabels(path: PathModel, stations: ReadonlyMap<string, Pick<Station, 'refs'>>, nodes: ReadonlyMap<string, KNode>): (string | null)[] {
    return path.hops.map((_, i) => {
        const st = stations.get(path.stops[i + 1]?.id ?? '');
        return hopRouteLabel((st?.refs ?? []).flatMap((r) => nodes.get(r) ?? []));
    });
}

/** The Mermaid sequence diagram of a path, exactly what the Sequence camera draws. */
export function pathMermaid(path: PathModel, labels: KnowledgeGraphLabels): string {
    return toSequenceMermaid(sequenceOf(path), (hop) => hopText(labels, hop));
}
