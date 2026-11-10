/**
 * engine/computeRunDelta.ts — THE run delta, as the PRD 41 §6 "Agent run" sequence:
 *
 *   1. resolve both sides (`ports.texts` / `ports.facts`), the attribution filter and rename matching
 *      ({@link resolveSides});
 *   2. the impact set (C2);
 *   3. every registry rule and metric rule on both sides;
 *   4. lineage (memory `matchLineage`) and comparability (memory `comparable`, routed per rule, C9);
 *   5. verdicts, the headline model, the blast radius, the §12.5 blocking list and the digest.
 *
 * A HEAD that moved to an unrelated branch (`headSwitched`) makes every dimension `not_comparable`
 * (`head-switched`) and runs no rule. Pure: everything outside comes through {@link DeltaPorts}.
 */

import type {
    DeltaFinding, DeltaPorts, DimensionId, DimensionRegistry, DimensionResult, MeasuredBy, MetricDelta, RuleInput,
    RunChangeSetInput, RunDelta, SideFacts,
} from '../contract.js';
import { TEST_INTEGRITY_ERROR_RULES } from '../registry/defaults.js';
import { blastRadius } from './blastRadius.js';
import { metaReasons, reasonsFor } from './comparability.js';
import { digestOf } from './digest.js';
import { findingsOf } from './findingLineage.js';
import { headlineModel } from './headline.js';
import { impactSet } from './impactSet.js';
import { resolveSides } from './resolve.js';
import { compareStr, normalizePath, sortedUnique } from './text.js';
import { dimensionVerdict, worst } from './verdict.js';

interface Bucket {
    ran: number;
    failed: string[];
    notComparable: string[];
    findings: DeltaFinding[];
    metrics: MetricDelta[];
    metricsNotComparable: Set<string>;
    measuredBy: MeasuredBy[];
}

/** Facts with every path normalized (imports, badges), so a Windows host and a Linux host agree. */
function normalizedFacts(f: SideFacts): SideFacts {
    const imports = new Map<string, string[]>();
    for (const [from, to] of f.imports) imports.set(normalizePath(from), sortedUnique([...(imports.get(normalizePath(from)) ?? []), ...to.map(normalizePath)]));
    const badges = new Map<string, Readonly<Record<string, number | string>>>();
    for (const [p, b] of f.badges) badges.set(normalizePath(p), b);
    return { ...f, imports, badges };
}

const isFresh = (f: DeltaFinding) => !f.presentNow && !f.waiver && (f.lineage === 'introduced' || f.lineage === 'changed');

function compareFinding(a: DeltaFinding, b: DeltaFinding): number {
    return compareStr(a.ruleId, b.ruleId) || compareStr(a.identity.anchor, b.identity.anchor)
        || compareStr(a.identity.id, b.identity.id) || compareStr(a.lineage, b.lineage);
}

export async function computeRunDelta(input: RunChangeSetInput, registry: DimensionRegistry, ports: DeltaPorts): Promise<RunDelta> {
    const sides = await resolveSides(input, ports);
    const [rawBefore, rawAfter] = await Promise.all([ports.facts('before'), ports.facts('after')]);
    const beforeFacts = normalizedFacts(rawBefore), afterFacts = normalizedFacts(rawAfter);

    const changedFiles = sides.changed.map((f) => f.path);
    const impact = impactSet(changedFiles, beforeFacts, afterFacts);
    const impactPaths = new Set([...changedFiles, ...sides.renamed.map((r) => r.from), ...impact.dependents, ...impact.entryPoints]);

    const [churnRaw, pastScores] = await Promise.all([ports.churn(changedFiles), ports.pastScores()]);
    const churn = new Map([...churnRaw].map(([p, n]) => [normalizePath(p), n]));

    const dimensionIds = sortedUnique(registry.dimensions) as DimensionId[];
    const buckets = new Map<DimensionId, Bucket>(dimensionIds.map((id) => [id, {
        ran: 0, failed: [], notComparable: [], findings: [], metrics: [], metricsNotComparable: new Set(), measuredBy: [],
    }]));

    if (!input.headSwitched) {
        const ruleInput: RuleInput = {
            changed: sides.changed, before: sides.before, after: sides.after, beforeFacts, afterFacts, registries: registry.registries,
        };
        const reasons = metaReasons(beforeFacts.meta, afterFacts.meta);
        for (const rule of [...registry.rules].sort((a, b) => compareStr(a.id, b.id))) {
            const bucket = buckets.get(rule.dimension);
            if (!bucket) continue;
            let out: ReturnType<typeof rule.derive>;
            try {
                out = rule.derive(ruleInput);
            } catch {
                bucket.failed.push(rule.id);
                bucket.measuredBy.push({ tool: rule.id, version: String(rule.version), status: 'failed', reason: 'rule-threw' });
                continue;
            }
            const gate = reasonsFor(rule, reasons);
            bucket.findings.push(...findingsOf(rule, out, gate.length === 0, impactPaths));
            bucket.notComparable.push(...gate);
            bucket.ran++;
            bucket.measuredBy.push({ tool: rule.id, version: String(rule.version), status: 'ok' });
        }
        for (const metric of [...registry.metrics].sort((a, b) => compareStr(a.id, b.id))) {
            const bucket = buckets.get(metric.dimension);
            if (!bucket) continue;
            let values: MetricDelta[];
            try {
                values = metric.derive(ruleInput);
            } catch {
                bucket.failed.push(metric.id);
                bucket.measuredBy.push({ tool: metric.id, version: String(metric.version), status: 'failed', reason: 'rule-threw' });
                continue;
            }
            const gate = reasonsFor(metric, reasons);
            for (const v of values) if (gate.length > 0) bucket.metricsNotComparable.add(v.metricId);
            bucket.notComparable.push(...gate);
            bucket.metrics.push(...values);
            bucket.ran++;
            bucket.measuredBy.push({ tool: metric.id, version: String(metric.version), status: 'ok' });
        }
    }

    const unresolved = sides.excluded.some((e) => e.reason !== 'changed-outside-run');
    const nothingResolved = unresolved && sides.inRunCount > 0 && sides.changed.length === 0;
    const integrityRules = new Set(TEST_INTEGRITY_ERROR_RULES);

    const dimensions: DimensionResult[] = dimensionIds.map((id) => {
        const b = buckets.get(id)!;
        const findings = b.findings.sort(compareFinding);
        const metrics = b.metrics.sort((x, y) => compareStr(x.metricId, y.metricId));
        const measuredBy = b.measuredBy.sort((x, y) => compareStr(x.tool, y.tool));
        if (input.headSwitched) return { id, verdict: 'not_comparable', reasons: ['head-switched'], findings, metrics, measuredBy };
        let { verdict, reasons } = dimensionVerdict({
            id, ran: b.ran, failed: b.failed, notComparable: sortedUnique(b.notComparable), findings, metrics,
            metricsNotComparable: b.metricsNotComparable, integrityRules,
        });
        if (unresolved && verdict !== 'not_measured') {
            reasons = sortedUnique([...reasons, 'before-unresolved']);
            if (nothingResolved) verdict = worst([verdict, 'not_comparable']);
        }
        return { id, verdict, reasons, findings, metrics, measuredBy };
    });

    const allFindings = dimensions.flatMap((d) => d.findings);
    const blockingRules = new Set(registry.registries.blocking);
    const blocking = input.mode === 'autonomous'
        ? sortedUnique(allFindings.filter((f) => isFresh(f) && blockingRules.has(f.ruleId)).map((f) => f.ruleId))
        : [];
    const summary = headlineModel(dimensions, integrityRules);

    const body: Omit<RunDelta, 'digest' | 'narrative'> = {
        version: 1,
        runId: input.runId,
        before: {
            manifestGeneration: beforeFacts.manifestGeneration, merkleRoot: beforeFacts.merkleRoot,
            ...(input.baseCommit !== undefined ? { baseCommit: input.baseCommit } : {}),
        },
        after: { manifestGeneration: afterFacts.manifestGeneration, merkleRoot: afterFacts.merkleRoot },
        impact: { changedFiles, renamed: sides.renamed, dependents: impact.dependents, entryPoints: impact.entryPoints },
        excluded: sides.excluded,
        dimensions,
        headline: summary.verdict,
        summary,
        blastRadius: blastRadius({ changedFiles, entryPoints: impact.entryPoints, before: beforeFacts, after: afterFacts, churn, pastScores }),
        blocking,
    };
    return { ...body, digest: digestOf(body) };
}
