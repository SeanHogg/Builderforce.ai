/**
 * engine/comparability.ts — which of memory `comparable()`'s reasons (PRD 41 §C9) gate ONE rule.
 *
 * The two sides' `ComparabilityMeta` are compared once (memory owns the rule set); each reason is
 * then routed to the rules it concerns:
 *  - `tool-missing:<t>`, `tool-version-changed:<t>`, `analyzer-failed:<t>` gate a rule whose
 *    `producers` (default `[rule.id]`) name `<t>`;
 *  - extractor reasons gate only rules that read extracted facts (`structure`/`body`); a `content`
 *    rule re-reads the normalized bytes itself, so an extractor change cannot skew it;
 *  - scope, repo, branch and truncation gate every rule.
 */

import { comparable, type ComparabilityMeta } from '@seanhogg/builderforce-memory/knowledge';
import type { FactKind } from '../contract.js';

const EXTRACTOR_REASONS: ReadonlySet<string> = new Set(['extractor-mismatch', 'extractor-version-changed', 'content-hash-rule-changed']);
const TOOL_PREFIXES = ['tool-missing:', 'tool-version-changed:', 'analyzer-failed:'] as const;

export interface Gated {
    id: string;
    reads: readonly FactKind[];
    producers?: readonly string[];
}

/** The meta reasons for this delta (sorted, deduped; empty = comparable). */
export function metaReasons(before: ComparabilityMeta, after: ComparabilityMeta): string[] {
    return comparable(before, after).reasons;
}

/** The subset of `reasons` that makes this rule's kind `not_comparable` (sorted, as given). */
export function reasonsFor(rule: Gated, reasons: readonly string[]): string[] {
    const producers = new Set(rule.producers ?? [rule.id]);
    const readsFacts = rule.reads.some((k) => k !== 'content');
    return reasons.filter((reason) => {
        const prefix = TOOL_PREFIXES.find((p) => reason.startsWith(p));
        if (prefix) return producers.has(reason.slice(prefix.length));
        if (EXTRACTOR_REASONS.has(reason)) return readsFacts;
        return true;
    });
}
