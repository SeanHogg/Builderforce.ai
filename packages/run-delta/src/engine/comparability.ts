/**
 * engine/comparability.ts — which of memory `comparable()`'s reasons (PRD 41 §C9) gate ONE rule.
 *
 * The two sides' `ComparabilityMeta` are compared once (memory owns the rule set); each reason is
 * then routed to the rules it concerns:
 *  - `tool-missing:<t>`, `tool-version-changed:<t>`, `analyzer-failed:<t>` gate a rule whose
 *    `producers` (default `[rule.id]`) name `<t>`;
 *  - every other reason (extractor, content-hash rule, scope, repo, branch, truncation) describes the
 *    extracted FACTS, so it gates only rules that read `structure`/`body` or are `global`. A `content`
 *    rule re-reads both sides' normalized bytes itself; only `head-switched` stops it.
 */

import { comparable, type ComparabilityMeta } from '@seanhogg/builderforce-memory/knowledge';
import type { FactKind } from '../contract.js';

const TOOL_PREFIXES = ['tool-missing:', 'tool-version-changed:', 'analyzer-failed:'] as const;

/** Whether a reason code is a comparability reason (memory's set, plus `head-switched`). */
export function isComparabilityReason(reason: string): boolean {
    return reason === 'head-switched'
        || TOOL_PREFIXES.some((p) => reason.startsWith(p))
        || /^(?:extractor-|content-hash-rule-changed$|scope-changed$|repo-changed$|branch-changed$|truncated$)/.test(reason);
}

export interface Gated {
    id: string;
    reads: readonly FactKind[];
    producers?: readonly string[];
    scope?: 'impact' | 'global';
}

/** The meta reasons for this delta (sorted, deduped; empty = comparable). */
export function metaReasons(before: ComparabilityMeta, after: ComparabilityMeta): string[] {
    return comparable(before, after).reasons;
}

/** The subset of `reasons` that makes this rule's kind `not_comparable` (sorted, as given). */
export function reasonsFor(rule: Gated, reasons: readonly string[]): string[] {
    const producers = new Set(rule.producers ?? [rule.id]);
    const readsFacts = rule.scope === 'global' || rule.reads.some((k) => k !== 'content');
    return reasons.filter((reason) => {
        const prefix = TOOL_PREFIXES.find((p) => reason.startsWith(p));
        if (prefix) return producers.has(reason.slice(prefix.length));
        return readsFacts;
    });
}
