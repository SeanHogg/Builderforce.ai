/**
 * The words of a path as a sequence: one message per hop ("references · 3", or "no direct
 * reference") and the Mermaid text of exactly that. ONE place, so the Sequence camera, the path
 * strip's *Copy as Mermaid* and its stop chips can never disagree.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { fillTemplate } from '../template';
import { edgeKindLabel } from '../names';
import type { PathHop, PathModel } from './path';
import { sequenceOf, toSequenceMermaid } from './sequenceModel';

/** A hop in words: the edge kind and how many references make it, or that there is none. */
export function hopText(labels: KnowledgeGraphLabels, hop: PathHop): string {
    const s = labels.surface;
    const words = hop.count === 0 ? s.noDirectReference : fillTemplate(s.pathHop, { kind: edgeKindLabel(labels, hop.kind), count: hop.count });
    return hop.cycle ? `${words} · ${s.cycleHop}` : words;
}

/** The Mermaid sequence diagram of a path, exactly what the Sequence camera draws. */
export function pathMermaid(path: PathModel, labels: KnowledgeGraphLabels): string {
    return toSequenceMermaid(sequenceOf(path), (hop) => hopText(labels, hop));
}
