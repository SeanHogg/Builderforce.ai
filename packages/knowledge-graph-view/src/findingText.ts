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
    // A contradiction names its two sides; one memory did not name falls back to its first two nodes.
    const sides = { fileA: f.nodes[0] ? labelFor(index, f.nodes[0]) : undefined, fileB: f.nodes[1] ? labelFor(index, f.nodes[1]) : undefined };
    return fillTemplate(template, { count: f.nodes.length, ...sides, ...f.params, items: findingItems(f, index) });
}

/**
 * The sentence a finding's row shows beside its title, when the finding says more than
 * its nodes do. A contradiction reads as WHICH sections disagree; nothing else has one.
 */
export function findingDetail(f: Finding, labels: KnowledgeGraphLabels, index: ReadonlyMap<string, KNode>): string | undefined {
    if (f.kind !== 'contradiction') return undefined;
    const named = (v: unknown) => typeof v === 'string' && v.trim() !== '';
    return named(f.params.fileA) && named(f.params.fileB) ? findingRequest(f, labels, index) : undefined;
}
