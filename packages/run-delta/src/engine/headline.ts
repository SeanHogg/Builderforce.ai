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
 *  - `not_comparable`: the first comparability reason (e.g. `head-switched`); count = findings shown
 *    as "present now".
 */

import { HEADLINE_ORDER, type DeltaFinding, type DimensionResult, type HeadlineClause, type HeadlineModel } from '../contract.js';
import { compareStr } from './text.js';
import { metricLevels, worst } from './verdict.js';

const SEVERITY_RANK = { error: 0, warn: 1, info: 2 } as const;

const fresh = (f: DeltaFinding) => !f.presentNow && !f.waiver && (f.lineage === 'introduced' || f.lineage === 'changed');

function worseClause(d: DimensionResult, integrityRules: ReadonlySet<string>): Omit<HeadlineClause, 'dimension' | 'verdict'> {
    const open = d.findings.filter(fresh);
    if (d.reasons.includes('tests-weakened')) {
        return { code: 'tests-weakened', count: open.filter((f) => f.severity === 'error' && integrityRules.has(f.ruleId)).length };
    }
    const byRule = new Map<string, { severity: number; count: number }>();
    for (const f of open) {
        const cur = byRule.get(f.ruleId) ?? { severity: 2, count: 0 };
        byRule.set(f.ruleId, { severity: Math.min(cur.severity, SEVERITY_RANK[f.severity]), count: cur.count + 1 });
    }
    const top = [...byRule].sort((a, b) => a[1].severity - b[1].severity || b[1].count - a[1].count || compareStr(a[0], b[0]))[0];
    if (top) return { code: top[0], count: top[1].count };
    const metric = d.metrics.find((m) => metricLevels(m).regression !== undefined);
    return metric ? { code: `metric:${metric.metricId}`, count: 1 } : { code: 'worse', count: 0 };
}

function clauseOf(d: DimensionResult, integrityRules: ReadonlySet<string>): HeadlineClause {
    const base = { dimension: d.id, verdict: d.verdict };
    if (d.verdict === 'worse') return { ...base, ...worseClause(d, integrityRules) };
    if (d.verdict === 'better') {
        const resolved = d.findings.filter((f) => !f.presentNow && f.lineage === 'resolved').length;
        return { ...base, ...(resolved > 0 ? { code: 'findings-resolved', count: resolved } : { code: 'metrics-improved', count: 1 }) };
    }
    const reason = d.reasons.find((r) => r !== 'not-comparable' && r !== 'static-only') ?? 'not-comparable';
    return { ...base, code: reason, count: d.findings.filter((f) => f.presentNow).length };
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
