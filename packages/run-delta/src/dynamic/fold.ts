/**
 * dynamic/fold.ts — how dynamic-tier results enter a delta, with no engine branch (principle 5: a check is
 * registry data):
 *
 *  1. {@link withDynamicRules}: every measurement of an `ok` check becomes an ordinary {@link DeltaRule}
 *     (its findings, `ruleId`) and, when it has metrics, a {@link MetricRule} (`<ruleId>.metrics`), so
 *     lineage, comparability, verdicts, headline and digest treat them like any other rule. A `failed` check
 *     becomes a rule that throws: the engine records `analyzer-failed:<check>` and its dimension folds to
 *     `not_comparable` (C9: "the tool failed or timed out on either side").
 *  2. {@link annotateDynamicTier}: after the engine ran, each dimension names what of the tier did NOT run —
 *     reason `dynamic-not-run:<check>` and a `skipped` measuredBy row with the why — a failed check's row carries
 *     its real reason, and `performance` drops `static-only` once a performance measurement ran. The digest
 *     is recomputed over the annotated delta.
 *
 * Pure. Results whose check is not decided by this host (no result at all) leave the delta untouched.
 */

import type { DeltaRule, DimensionId, DimensionRegistry, DynamicTierEntry, MeasuredBy, MetricRule, RunDelta } from '../contract.js';
import { digestOf } from '../engine/digest.js';
import { compareStr, sortedUnique } from '../engine/text.js';
import { DYNAMIC_CHECK_DIMENSION, type DynamicCheckResult } from './contract.js';

/** A dynamic finding/metric rule reads both sides' measured output, never extracted facts. */
const READS = ['content'] as const;

export const metricRuleId = (ruleId: string): string => `${ruleId}.metrics`;

/** The registry with the dynamic results registered as rules (sorted by id by the engine). */
export function withDynamicRules(registry: DimensionRegistry, results: readonly DynamicCheckResult[]): DimensionRegistry {
    const rules: DeltaRule[] = [];
    const metrics: MetricRule[] = [];
    for (const r of results) {
        if (r.status === 'failed') {
            rules.push({
                id: r.check, version: 1, dimension: DYNAMIC_CHECK_DIMENSION[r.check], reads: READS,
                derive() { throw new Error(`dynamic check failed: ${r.reason ?? 'failed'}`); },
            });
            continue;
        }
        if (r.status !== 'ok') continue;
        for (const m of r.measurements) {
            // A metrics-only measurement (benchmarks) registers no empty finding rule.
            if (m.metrics.length === 0 || m.findings.before.length + m.findings.after.length > 0) {
                rules.push({ id: m.ruleId, version: m.ruleVersion, dimension: m.dimension, reads: READS, derive: () => m.findings });
            }
            if (m.metrics.length > 0) {
                metrics.push({ id: metricRuleId(m.ruleId), version: m.ruleVersion, dimension: m.dimension, reads: READS, derive: () => m.metrics });
            }
        }
    }
    if (rules.length === 0 && metrics.length === 0) return registry;
    return { ...registry, rules: [...registry.rules, ...rules], metrics: [...registry.metrics, ...metrics] };
}

/** `dynamic-not-run:<check>` — a stable tool-prefixed reason code, localized at render; WHY is its `skipped` measuredBy row's reason. */
export const dynamicNotRunReason = (check: string): string => `dynamic-not-run:${check}`;

/** The delta with the tier's coverage stated per dimension, and its digest recomputed. */
export function annotateDynamicTier(delta: RunDelta, results: readonly DynamicCheckResult[]): RunDelta {
    if (results.length === 0) return delta;
    const extraReasons = new Map<DimensionId, string[]>();
    const extraRows = new Map<DimensionId, MeasuredBy[]>();
    const failedRows = new Map<string, DynamicCheckResult>();
    const ranIn = new Set<DimensionId>();
    const add = <T>(map: Map<DimensionId, T[]>, id: DimensionId, v: T) => map.set(id, [...(map.get(id) ?? []), v]);

    for (const r of results) {
        const dim = DYNAMIC_CHECK_DIMENSION[r.check];
        if (r.status === 'skipped') {
            const reason = r.reason ?? 'not-scheduled';
            add(extraReasons, dim, dynamicNotRunReason(r.check));
            add(extraRows, dim, { tool: r.check, version: r.version, status: 'skipped', reason });
        } else if (r.status === 'failed') {
            failedRows.set(r.check, r);
        } else {
            for (const m of r.measurements) ranIn.add(m.dimension);
        }
    }

    const dimensions = delta.dimensions.map((d) => {
        let reasons = [...d.reasons, ...(extraReasons.get(d.id) ?? [])];
        if (ranIn.has(d.id)) reasons = reasons.filter((x) => x !== 'static-only');
        const measuredBy = [...d.measuredBy.map((row) => {
            const failed = failedRows.get(row.tool);
            return failed && row.status === 'failed'
                ? { ...row, version: failed.version, ...(failed.reason ? { reason: failed.reason } : {}) }
                : row;
        }), ...(extraRows.get(d.id) ?? [])].sort((a, b) => compareStr(a.tool, b.tool));
        return { ...d, reasons: sortedUnique(reasons), measuredBy };
    });
    // D9.1: who decided each check, persisted with the delta and covered by its digest (WS20 replays and learns from it).
    const dynamic: DynamicTierEntry[] = [...results].sort((a, b) => compareStr(a.check, b.check)).map((r) => ({
        check: r.check, status: r.status, ...(r.reason !== undefined ? { reason: r.reason } : {}), tool: r.tool, version: r.version,
        scheduledBy: {
            policy: r.scheduledBy.policy,
            ...(r.scheduledBy.modelId !== undefined ? { modelId: r.scheduledBy.modelId } : {}),
            ...(r.scheduledBy.modelVersion !== undefined ? { modelVersion: r.scheduledBy.modelVersion } : {}),
            ...(r.scheduledBy.p !== undefined ? { p: r.scheduledBy.p } : {}),
            ...(r.scheduledBy.seed !== undefined ? { seed: r.scheduledBy.seed } : {}),
            ...(r.scheduledBy.wouldRun !== undefined ? { wouldRun: r.scheduledBy.wouldRun } : {}),
        },
    }));
    const { digest: _digest, narrative, ...rest } = delta;
    const body = { ...rest, dimensions, dynamic };
    return { ...body, ...(narrative ? { narrative } : {}), digest: digestOf(body) };
}
