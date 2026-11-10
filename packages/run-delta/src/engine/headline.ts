/**
 * engine/headline.ts — the C10 headline as a deterministic sentence MODEL. No English here: each
 * clause is a dimension, its verdict, a stable code and a count, and the UI renders the sentence from
 * its localized catalog ("Worse: security (1 route lost its auth guard) and quality (2 tests
 * weakened). Performance unchanged.").
 *
 * Clause codes:
 *  - `worse`: `tests-weakened` when the quality dimension carries C8.2 errors; otherwise the rule id of
 *    the most severe introduced/changed findings (severity, then count, then id); `metric:<id>` when
 *    only a metric regressed.
 *  - `better`: `findings-resolved` (count = resolved findings), else `metrics-improved`.
 *  - `not_comparable`: the COMPARABILITY reason (`head-switched` first, then the first memory
 *    comparability reason such as `tool-version-changed:jscpd`, then `before-unresolved`); count =
 *    findings shown as `present`.
 */

import { HEADLINE_ORDER, type DimensionResult, type HeadlineClause, type HeadlineModel } from '../contract.js';
import { isComparabilityReason } from './comparability.js';
import { isFresh } from './findingFacts.js';
import { compareStr } from './text.js';
import { isIntegrityError, metricLevels, worst } from './verdict.js';

const SEVERITY_RANK = { error: 0, warn: 1, info: 2 } as const;

function worseClause(d: DimensionResult, integrityRules: ReadonlySet<string>): Omit<HeadlineClause, 'dimension' | 'verdict'> {
    const fresh = d.findings.filter(isFresh);
    if (d.reasons.includes('tests-weakened')) {
        return { code: 'tests-weakened', count: fresh.filter((f) => isIntegrityError(f, integrityRules)).length };
    }
    const byRule = new Map<string, { severity: number; count: number }>();
    for (const f of fresh) {
        const cur = byRule.get(f.ruleId) ?? { severity: 2, count: 0 };
        byRule.set(f.ruleId, { severity: Math.min(cur.severity, SEVERITY_RANK[f.severity]), count: cur.count + 1 });
    }
    const top = [...byRule].sort((a, b) => a[1].severity - b[1].severity || b[1].count - a[1].count || compareStr(a[0], b[0]))[0];
    if (top) return { code: top[0], count: top[1].count };
    const metric = d.metrics.find((m) => metricLevels(m).regression !== undefined);
    return metric ? { code: `metric:${metric.metricId}`, count: 1 } : { code: 'worse', count: 0 };
}

function notComparableCode(reasons: readonly string[]): string {
    if (reasons.includes('head-switched')) return 'head-switched';
    return reasons.find((r) => r !== 'head-switched' && isComparabilityReason(r))
        ?? (reasons.includes('before-unresolved') ? 'before-unresolved' : 'not-comparable');
}

function clauseOf(d: DimensionResult, integrityRules: ReadonlySet<string>): HeadlineClause {
    const base = { dimension: d.id, verdict: d.verdict };
    if (d.verdict === 'worse') return { ...base, ...worseClause(d, integrityRules) };
    if (d.verdict === 'better') {
        const resolved = d.findings.filter((f) => f.lineage === 'resolved').length;
        return { ...base, ...(resolved > 0 ? { code: 'findings-resolved', count: resolved } : { code: 'metrics-improved', count: 1 }) };
    }
    return { ...base, code: notComparableCode(d.reasons), count: d.findings.filter((f) => f.lineage === 'present').length };
}

export function headlineModel(dimensions: readonly DimensionResult[], integrityRules: ReadonlySet<string>): HeadlineModel {
    const sorted = [...dimensions].sort((a, b) => compareStr(a.id, b.id));
    const clauses = sorted
        .filter((d) => d.verdict === 'worse' || d.verdict === 'not_comparable' || d.verdict === 'better')
        .map((d) => clauseOf(d, integrityRules))
        .sort((a, b) => HEADLINE_ORDER.indexOf(a.verdict) - HEADLINE_ORDER.indexOf(b.verdict) || compareStr(a.dimension, b.dimension));
    return {
        verdict: worst(sorted.map((d) => d.verdict)),
        clauses,
        unchanged: sorted.filter((d) => d.verdict === 'same').map((d) => d.id),
        notMeasured: sorted.filter((d) => d.verdict === 'not_measured').map((d) => d.id),
    };
}
