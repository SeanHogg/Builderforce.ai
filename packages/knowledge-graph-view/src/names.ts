/**
 * The words for ids the graph carries — an edge's kind, a node's pack — from the label
 * maps, falling back to the raw id for a kind this build has no words for (never blank).
 */

import { camelKind } from './template';
import type { KnowledgeGraphLabels } from './labels';

export function edgeKindLabel(labels: Pick<KnowledgeGraphLabels, 'edgeKinds'>, kind: string): string {
    return labels.edgeKinds[camelKind(kind)] ?? kind;
}

export function packLabel(labels: Pick<KnowledgeGraphLabels, 'packs'>, pack: string): string {
    return labels.packs[pack] ?? pack;
}
