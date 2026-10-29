/**
 * The words for ids the graph carries — an edge's kind, a node's pack, a node's kind — from the label
 * maps, falling back to the raw id for a kind this build has no words for (never blank).
 */

import { camelKind } from './template';
import type { KnowledgeGraphLabels } from './labels';

export function edgeKindLabel(labels: Pick<KnowledgeGraphLabels, 'edgeKinds'>, kind: string): string {
    return labels.edgeKinds[camelKind(kind)] ?? kind;
}

/** A node's kind (or a legend row's key), in words; the raw id for a kind this build has none for. */
export function kindLabel(labels: Pick<KnowledgeGraphLabels, 'legend'>, kind: string): string {
    return labels.legend[kind] ?? kind;
}

export function packLabel(labels: Pick<KnowledgeGraphLabels, 'packs'>, pack: string): string {
    return labels.packs[pack] ?? pack;
}
