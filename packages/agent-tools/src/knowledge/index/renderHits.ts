/**
 * Knowledge-index recall as text — ONE renderer for both places hits reach a turn
 * (docs/design/deterministic-knowledge-index.md, "Consumers"):
 *
 *   - `knowledge.ask`'s ANSWER (the hits, settled with no model) and its PREFETCH
 *     fallback (the same hits as context for the model);
 *   - the context pack's knowledge part (the editor's pre-search, the volatile tail).
 *
 * Each line: the path (or the node's label), its kind and partition, and a short excerpt
 * of its card. Pure.
 */

import { DEFAULT_INDEX_PARAMS, type IndexHit, type IndexTier } from '@seanhogg/builderforce-memory/knowledge';
import type { RecalledHit } from './contract.js';

/** Characters of a card shown per hit. */
export const HIT_EXCERPT_CHARS = 140;
/** One tier's agreement alone is weaker evidence than two tiers agreeing on the top hit. */
export const SINGLE_TIER_WEIGHT = 0.5;

/**
 * How sure the index is of its top hit, 0–1: an exact key hit is certain (1); a fused hit
 * is its RRF score over the best score the tiers that ran could give (first in every
 * list), halved when only one non-exact tier ran. What `knowledge.ask` reports as its
 * `confidence`; the gate compares it with the action's learned answer threshold.
 */
export function hitConfidence(hits: readonly IndexHit[], tiers: readonly IndexTier[], rrfK: number = DEFAULT_INDEX_PARAMS.rrfK): number {
    const top = hits[0];
    if (!top) return 0;
    if (top.tier === 'exact') return 1;
    const lists = tiers.filter((t) => t !== 'exact').length;
    if (lists === 0) return 0;
    const norm = Math.min(1, Math.max(0, (top.score * (rrfK + 1)) / lists));
    return lists >= 2 ? norm : norm * SINGLE_TIER_WEIGHT;
}

const clip = (s: string, n: number): string => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** One hit as a markdown list line. */
export function hitLine(h: RecalledHit): string {
    const name = h.path ? `\`${h.path}\`` : `**${h.meta?.label ?? h.id}**`;
    const facets = [h.meta?.kind, h.meta?.partition].filter(Boolean).join(', ');
    const excerpt = h.meta?.text ? ` — ${clip(h.meta.text, HIT_EXCERPT_CHARS)}` : '';
    return `- ${name}${facets ? ` (${facets})` : ''}${excerpt}`;
}

export interface RenderHitsOptions {
    /** Hits whose path is already in the turn (the pre-search's) are left out. */
    exclude?: ReadonlySet<string>;
    max?: number;
}

/** The hits worth showing: not excluded, at most `max`, search hits before expanded ones. */
export function shownHits(hits: readonly RecalledHit[], opts: RenderHitsOptions = {}): RecalledHit[] {
    const max = opts.max ?? 8;
    const kept = hits.filter((h) => !(h.path && opts.exclude?.has(h.path)));
    return [...kept.filter((h) => !h.expanded), ...kept.filter((h) => h.expanded)].slice(0, max);
}

/** The context block (PREFETCH and the context pack); '' when nothing is left to show. */
export function renderKnowledgeContext(query: string, hits: readonly RecalledHit[], tiers: readonly IndexTier[], opts: RenderHitsOptions = {}): string {
    const shown = shownHits(hits, opts);
    if (shown.length === 0) return '';
    const own = shown.filter((h) => !h.expanded);
    const related = shown.filter((h) => h.expanded);
    const lines = [
        '## Knowledge index (deterministic recall over this root\'s knowledge graph, gathered with no model call)',
        `Query: "${clip(query, 120)}" · tiers: ${tiers.join(', ')}`,
        ...own.map(hitLine),
        ...(related.length ? ['Related (one hop in the graph):', ...related.map(hitLine)] : []),
        'Open these first instead of searching for them.',
    ];
    return lines.join('\n');
}

/** The settled answer: the top hits, then their neighbours. */
export function renderKnowledgeAnswer(query: string, hits: readonly RecalledHit[], opts: RenderHitsOptions = {}): string {
    const shown = shownHits(hits, opts);
    const own = shown.filter((h) => !h.expanded);
    const related = shown.filter((h) => h.expanded);
    const lines = [
        `**Knowledge index** — what this root's knowledge graph says about "${clip(query, 120)}":`,
        '',
        ...own.map(hitLine),
        ...(related.length ? ['', 'Related:', ...related.map(hitLine)] : []),
    ];
    return lines.join('\n');
}
