/**
 * rules/support/strideRows.ts — the C5.7 STRIDE checklist of one new entry point or capability: for each
 * category, the first (sorted) registry coverage name present among the facts (`strideCoverage`: guards,
 * validators, rate limiters, audit helpers), or `uncovered`. A deterministic template filled from facts,
 * never model output. Params `stride-spoofing` … `stride-elevation-of-privilege`.
 *
 * Heuristic: names are matched as identifiers in masked text; WS4 guard-chain facts replace the scan.
 */
import { STRIDE_CATEGORIES } from '../../registry/stride.js';
import { escapeRegex, perInput } from './files.js';
export const STRIDE_UNCOVERED = 'uncovered';
export function strideCoverageOf(input) {
    return perInput(input, 'strideCoverage', () => {
        const reg = input.registries.strideCoverage;
        const byCategory = STRIDE_CATEGORIES.map((c) => [c, [...new Set(reg[c] ?? [])].sort()]);
        const all = [...new Set(byCategory.flatMap(([, n]) => n))].sort();
        const re = all.length > 0 ? new RegExp(`(?<![\\w$])(?:${all.map(escapeRegex).join('|')})(?![\\w$])`, 'g') : undefined;
        const namesInText = (bare) => new Set(re ? bare.match(re) ?? [] : []);
        return {
            byCategory,
            namesInText,
            namesIn: (view) => view.memo('stride:names', () => namesInText(view.bare)),
        };
    });
}
/** `{ 'stride-spoofing': 'requireAuth', 'stride-tampering': 'uncovered', … }`. */
export function strideRows(present, coverage) {
    const rows = {};
    for (const [category, names] of coverage.byCategory)
        rows[`stride-${category}`] = names.find((n) => present.has(n)) ?? STRIDE_UNCOVERED;
    return rows;
}
//# sourceMappingURL=strideRows.js.map