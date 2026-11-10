/**
 * engine/computeRunDelta.ts — THE run delta, as the PRD 41 §6 "Agent run" sequence:
 *
 *   1. resolve both sides (`ports.texts` / `ports.facts`), the attribution filter and rename matching
 *      ({@link resolveSides});
 *   2. the impact set (C2);
 *   3. every registry rule and metric rule on both sides;
 *   4. lineage (memory `matchLineage`) and comparability (memory `comparable`, routed per rule, C9);
 *   5. verdicts, the headline model, the blast radius, the §12.5 blocking codes and the digest.
 *
 * A HEAD that moved to an unrelated branch (`headSwitched`) makes every dimension `not_comparable`
 * (`head-switched`) and runs no rule. A rule that throws is `analyzer-failed:<ruleId>`: its dimension
 * folds to `not_comparable`. Blocking FAILS CLOSED ({@link blockingCodes}). Pure: everything outside
 * comes through {@link DeltaPorts}.
 */

import type {
    ComputeOptions, DeltaFinding, DeltaPorts, DimensionId, DimensionRegistry, DimensionResult, MeasuredBy, MetricDelta, RuleInput,
    RunChangeSetInput, RunDelta, SideFacts,
} from '../contract.js';
import { canonicalFileFacts } from '@seanhogg/builderforce-memory/knowledge';
import { TEST_INTEGRITY_RULES } from '../registry/defaults.js';
import { analyzerKindTools, analyzerTier, type AnalyzerTier, type KindStatus } from './analyzers.js';
import { blastRadius } from './blastRadius.js';
import { metaReasons, reasonsFor } from './comparability.js';
import { digestOf } from './digest.js';
import { isFresh } from './findingFacts.js';
import { findingsOf } from './findingLineage.js';
import { headlineModel } from './headline.js';
import { impactSet } from './impactSet.js';
import { resolveSides } from './resolve.js';
import { compareStr, normalizePath, sortedUnique } from './text.js';
import { dimensionVerdict, worst } from './verdict.js';

interface Bucket {
    ran: number;
    /** Reasons that are not verdict inputs (`analyzer-not-measured:<tool>`). */
    extra: string[];
    failed: string[];
    notComparable: string[];
    findings: DeltaFinding[];
    metrics: MetricDelta[];
    metricsNotComparable: Set<string>;
    measuredBy: MeasuredBy[];
}

/** Whether each rule (or metric rule, or analyzer kind) id could certify the run: ran, and its kind is comparable; `pending` = phase 1. */
type RuleStatus = Map<string, KindStatus>;

/** Facts with every path normalized (imports, badges), so a Windows host and a Linux host agree. */
function normalizedFacts(f: SideFacts): SideFacts {
    const imports = new Map<string, string[]>();
    for (const [from, to] of f.imports) imports.set(normalizePath(from), sortedUnique([...(imports.get(normalizePath(from)) ?? []), ...to.map(normalizePath)]));
    const badges = new Map<string, Readonly<Record<string, number | string>>>();
    for (const [p, b] of f.badges) badges.set(normalizePath(p), b);
    // FileFacts: keys normalized here; their own path fields are normalized by memory's `canonicalFileFacts`.
    const fileFacts = f.fileFacts ? new Map([...f.fileFacts].map(([p, ff]) => [normalizePath(p), canonicalFileFacts(ff)] as const)) : undefined;
    return { ...f, imports, badges, ...(fileFacts ? { fileFacts } : {}) };
}

function compareFinding(a: DeltaFinding, b: DeltaFinding): number {
    return compareStr(a.ruleId, b.ruleId) || compareStr(a.identity.anchor, b.identity.anchor)
        || compareStr(a.identity.id, b.identity.id) || compareStr(a.lineage, b.lineage);
}

/**
 * §12.5, fail-closed. For an autonomous run: every blocking rule with a fresh ERROR finding (its id);
 * every blocking rule that could not certify the run (`not-comparable:<id>`); `head-switched` when no
 * rule ran at all. Interactive runs never block. The registry's analyzer kinds certify like rules, whether or not the
 * host runs the tier (fail-closed); one still measuring in a phase-1 delta is `analyzer-pending:<tool>` (the hold waits
 * for the final delta).
 */
export function blockingCodes(
    input: RunChangeSetInput, registry: DimensionRegistry, findings: readonly DeltaFinding[], status: RuleStatus,
): string[] {
    if (input.mode !== 'autonomous') return [];
    const blocking = new Set(registry.registries.blocking);
    const kindTools = analyzerKindTools(registry.analyzers ?? []);
    const registered = sortedUnique([...registry.rules, ...registry.metrics].map((r) => r.id).concat([...kindTools.keys()])).filter((id) => blocking.has(id));
    if (registered.length === 0) return [];
    if (input.headSwitched) return ['head-switched'];
    const codes = findings.filter((f) => isFresh(f) && f.severity === 'error' && blocking.has(f.ruleId)).map((f) => f.ruleId);
    for (const id of registered) {
        const s = status.get(id);
        if (s === 'pending') codes.push(`analyzer-pending:${kindTools.get(id)}`);
        else if (s !== 'ok') codes.push(`not-comparable:${id}`);
    }
    return sortedUnique(codes);
}

export async function computeRunDelta(
    input: RunChangeSetInput, registry: DimensionRegistry, ports: DeltaPorts, options: ComputeOptions = {},
): Promise<RunDelta> {
    const sides = await resolveSides(input, ports);
    const [rawBefore, rawAfter] = await Promise.all([ports.facts('before'), ports.facts('after')]);
    const beforeFacts = normalizedFacts(rawBefore), afterFacts = normalizedFacts(rawAfter);

    const changedFiles = sides.changed.map((f) => f.path);
    const impact = impactSet(changedFiles, beforeFacts, afterFacts);
    const kept = new Set(changedFiles);
    const scope = {
        impact: new Set([...changedFiles, ...sides.renamed.map((r) => r.from), ...impact.dependents, ...impact.entryPoints]),
        excluded: new Set(sides.excluded.map((e) => e.path).filter((p) => !kept.has(p))),
        unknownBefore: new Set(sides.unknownBefore),
    };

    const [churnRaw, pastScores] = await Promise.all([ports.churn(changedFiles), ports.pastScores()]);
    const churn = new Map([...churnRaw].map(([p, n]) => [normalizePath(p), n]));

    const dimensionIds = sortedUnique(registry.dimensions) as DimensionId[];
    const buckets = new Map<DimensionId, Bucket>(dimensionIds.map((id) => [id, {
        ran: 0, extra: [], failed: [], notComparable: [], findings: [], metrics: [], metricsNotComparable: new Set(), measuredBy: [],
    }]));
    const status: RuleStatus = new Map();
    // L3 (B7) first: a kind the tool measured this run supersedes the static-tier rule of the same id (only then).
    const staticIds = new Set([...registry.rules, ...registry.metrics].map((r) => r.id));
    const tier: AnalyzerTier | undefined = input.headSwitched || !registry.analyzers?.length ? undefined
        : await analyzerTier(registry.analyzers, ports, scope, { ...options, staticIds, blocking: new Set(registry.registries.blocking) });
    const superseded = tier?.superseded ?? new Set<string>();

    if (!input.headSwitched) {
        const ruleInput: RuleInput = {
            changed: sides.changed, before: sides.before, after: sides.after, beforeFacts, afterFacts,
            registries: registry.registries, runKind: input.kind ?? 'standard', churn,
            ...(input.plannedPaths ? { plannedPaths: input.plannedPaths.map(normalizePath) } : {}),
        };
        const reasons = metaReasons(beforeFacts.meta, afterFacts.meta);
        const fail = (bucket: Bucket, id: string, version: number) => {
            bucket.failed.push(id);
            bucket.notComparable.push(`analyzer-failed:${id}`);
            bucket.measuredBy.push({ tool: id, version: String(version), status: 'failed', reason: 'rule-threw' });
            status.set(id, 'not-comparable');
        };
        for (const rule of [...registry.rules].sort((a, b) => compareStr(a.id, b.id))) {
            const bucket = buckets.get(rule.dimension);
            if (!bucket || superseded.has(rule.id)) continue;
            if (rule.applies && !rule.applies(ruleInput)) {
                // Cannot measure this run (e.g. no plan for scope drift): listed, never counted as a measurement.
                bucket.measuredBy.push({ tool: rule.id, version: String(rule.version), status: 'skipped', reason: rule.skipReason ?? 'not-applicable' });
                continue;
            }
            let out: ReturnType<typeof rule.derive>;
            try {
                out = rule.derive(ruleInput);
            } catch {
                fail(bucket, rule.id, rule.version);
                continue;
            }
            const gate = reasonsFor(rule, reasons);
            bucket.findings.push(...findingsOf(rule, out, gate.length === 0, scope));
            bucket.notComparable.push(...gate);
            bucket.ran++;
            bucket.measuredBy.push({ tool: rule.id, version: String(rule.version), status: 'ok' });
            status.set(rule.id, gate.length === 0 ? 'ok' : 'not-comparable');
        }
        for (const metric of [...registry.metrics].sort((a, b) => compareStr(a.id, b.id))) {
            const bucket = buckets.get(metric.dimension);
            if (!bucket) continue;
            let values: MetricDelta[];
            try {
                values = metric.derive(ruleInput);
            } catch {
                fail(bucket, metric.id, metric.version);
                continue;
            }
            const gate = reasonsFor(metric, reasons);
            for (const v of values) if (gate.length > 0) bucket.metricsNotComparable.add(v.metricId);
            bucket.notComparable.push(...gate);
            bucket.metrics.push(...values);
            bucket.ran++;
            bucket.measuredBy.push({ tool: metric.id, version: String(metric.version), status: 'ok' });
            status.set(metric.id, gate.length === 0 ? 'ok' : 'not-comparable');
        }
        if (tier) {
            for (const c of tier.contributions) {
                const bucket = buckets.get(c.dimension);
                if (!bucket) continue;
                if (c.ran) bucket.ran++;
                bucket.findings.push(...c.findings);
                bucket.metrics.push(...c.metrics);
                for (const m of c.metricsNotComparable) bucket.metricsNotComparable.add(m);
                bucket.notComparable.push(...c.notComparable);
                bucket.extra.push(...c.reasons);
                bucket.measuredBy.push(...c.measuredBy);
            }
            for (const [kind, s] of tier.status) status.set(kind, s);
        }
    }

    const unresolved = sides.unknownBefore.length > 0;
    const nothingResolved = unresolved && sides.changed.every((f) => scope.unknownBefore.has(f.path));
    const integrityRules = new Set(TEST_INTEGRITY_RULES);
    const blockingRules = new Set(registry.registries.blocking);

    const dimensions: DimensionResult[] = dimensionIds.map((id) => {
        const b = buckets.get(id)!;
        const findings = b.findings.sort(compareFinding);
        const metrics = b.metrics.sort((x, y) => compareStr(x.metricId, y.metricId));
        const measuredBy = b.measuredBy.sort((x, y) => compareStr(x.tool, y.tool) || compareStr(x.side ?? '', y.side ?? ''));
        if (input.headSwitched) return { id, verdict: 'not_comparable', reasons: ['head-switched'], findings, metrics, measuredBy };
        let { verdict, reasons } = dimensionVerdict({
            id, ran: b.ran, failed: b.failed, notComparable: sortedUnique(b.notComparable), findings, metrics,
            metricsNotComparable: b.metricsNotComparable, integrityRules, blockingRules,
        });
        // An analyzer that did not measure says so by name; a dimension it alone covers is not "rule not built".
        if (b.extra.length > 0) reasons = sortedUnique([...reasons.filter((r) => r !== 'rule-not-built'), ...b.extra]);
        if (unresolved && verdict !== 'not_measured') {
            reasons = sortedUnique([...reasons, 'before-unresolved']);
            if (nothingResolved) verdict = worst([verdict, 'not_comparable']);
        }
        return { id, verdict, reasons, findings, metrics, measuredBy };
    });

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
        blocking: blockingCodes(input, registry, dimensions.flatMap((d) => d.findings), status),
    };
    return { ...body, digest: digestOf(body) };
}
