/**
 * A finding's words: its kind's name and its FIXED Fix-with-agent request. The request
 * is the template named by the finding's `requestKey` (`knowledgeGraph.fix.cloneGroup` →
 * `labels.fix.cloneGroup`), filled from the finding's own params plus `{items}` (the
 * first few node labels) — never a model call (PRD 38 §3.5).
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { camelKind, fillTemplate, type KnowledgeGraphLabels } from './labels';
import { labelFor } from './graphModel';

/** Node labels named in a request, at most. */
export const REQUEST_ITEMS = 5;

export function findingTitle(f: Pick<Finding, 'kind'>, labels: KnowledgeGraphLabels): string {
    return labels.findingKinds[camelKind(f.kind)] ?? labels.findingKinds.other ?? f.kind;
}

export function findingItems(f: Finding, index: ReadonlyMap<string, KNode>): string {
    const names = f.nodes.slice(0, REQUEST_ITEMS).map((r) => labelFor(index, r));
    const more = f.nodes.length - names.length;
    return more > 0 ? `${names.join(', ')} (+${more})` : names.join(', ');
}

export function findingRequest(f: Finding, labels: KnowledgeGraphLabels, index: ReadonlyMap<string, KNode>): string {
    const key = camelKind(f.requestKey ?? f.kind);
    const template = labels.fix[key] ?? labels.fix.generic ?? '{items}';
    return fillTemplate(template, { count: f.nodes.length, ...f.params, items: findingItems(f, index) });
}
