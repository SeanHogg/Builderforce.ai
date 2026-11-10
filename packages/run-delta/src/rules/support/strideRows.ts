/**
 * rules/support/strideRows.ts — the C5.7 STRIDE checklist of one new entry point or capability: for each
 * category, the first (sorted) registry coverage name present among the facts (`strideCoverage`: guards,
 * validators, rate limiters, audit helpers), or `uncovered`. A deterministic template filled from facts,
 * never model output. Params `stride-spoofing` … `stride-elevation-of-privilege`.
 *
 * Heuristic: names are matched as identifiers in masked text; WS4 guard-chain facts replace the scan.
 */

import type { RuleInput, StrideCategory } from '../../contract.js';
import { STRIDE_CATEGORIES } from '../../registry/stride.js';
import { escapeRegex, perInput, type TextView } from './files.js';

export const STRIDE_UNCOVERED = 'uncovered';

export interface StrideCoverage {
    readonly byCategory: ReadonlyArray<readonly [StrideCategory, readonly string[]]>;
    /** Every coverage name used as an identifier in a whole file's masked text (memoized per view). */
    namesIn(view: TextView): Set<string>;
    /** Every coverage name used as an identifier in a masked slice (a route's call span). */
    namesInText(bare: string): Set<string>;
}

export function strideCoverageOf(input: RuleInput): StrideCoverage {
    return perInput(input, 'strideCoverage', () => {
        const reg = input.registries.strideCoverage;
        const byCategory = STRIDE_CATEGORIES.map((c) => [c, [...new Set(reg[c] ?? [])].sort()] as const);
        const all = [...new Set(byCategory.flatMap(([, n]) => n))].sort();
        const re = all.length > 0 ? new RegExp(`(?<![\\w$])(?:${all.map(escapeRegex).join('|')})(?![\\w$])`, 'g') : undefined;
        const namesInText = (bare: string): Set<string> => new Set(re ? bare.match(re) ?? [] : []);
        return {
            byCategory,
            namesInText,
            namesIn: (view: TextView) => view.memo('stride:names', () => namesInText(view.bare)),
        };
    });
}

/** `{ 'stride-spoofing': 'requireAuth', 'stride-tampering': 'uncovered', … }`. */
export function strideRows(present: ReadonlySet<string>, coverage: StrideCoverage): Record<string, string> {
    const rows: Record<string, string> = {};
    for (const [category, names] of coverage.byCategory) rows[`stride-${category}`] = names.find((n) => present.has(n)) ?? STRIDE_UNCOVERED;
    return rows;
}
