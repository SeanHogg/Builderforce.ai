/**
 * engine/analyzers.ts — the L3 analyzer tier of the delta (PRD 41 §B7, §6 "Agent run" step 4): every
 * {@link AnalyzerRule} row's results on both sides (`DeltaPorts.analyze`), into its dimensions with
 * `measuredBy`, lineage (`findingsOf`, memory `matchLineage`) and C9 comparability through the SAME
 * `producers` mechanism the rules use (`reasonsFor` over memory `comparable()` of the two sides' tool meta).
 *
 * Per tool, by how each side ended:
 *  - phase 1 (`ComputeOptions.analyzers: 'pending'`): nothing is asked; the row is `pending` (`analyzer-pending:<tool>`);
 *  - after side `failed`/`skipped` (or the port threw): its kinds are `not_measured` — no findings, the reason
 *    `analyzer-not-measured:<tool>`, and the run in `measuredBy` with its reason. Never zero findings.
 *  - after `ok`, before `failed`/`skipped`: memory's `analyzer-failed:<tool>` / `tool-missing:<tool>`;
 *  - both `ok` at different versions (or different data dates): `tool-version-changed:<tool>`;
 *  - data older than the row's `maxDataAgeDays` (or undated): `analyzer-data-stale:<tool>`.
 *    Either way the kinds are `not_comparable`: after-side findings are `present`, never introduced or resolved.
 *  - both `ok` at one version: lineage as for any rule.
 * A kind that is also a static-tier rule id is SUPERSEDED only when its tool measured this run (after `ok`, and before
 * `ok` when asked); otherwise the static rule stands and the tool only says why it did not measure.
 *
 * Pure: results come through the port; the host runs the tools (agent-tools `delta/adapters`).
 */

import type {
    AnalyzerFinding, AnalyzerResult, AnalyzerRule, ComputeOptions, DeltaFinding, DeltaPorts, DeltaRule, DimensionId, MeasuredBy, MetricDelta,
} from '../contract.js';
import { tagStride } from '../registry/stride.js';
import { metaReasons, reasonsFor } from './comparability.js';
import { findingsOf, type LineageScope } from './findingLineage.js';
import { compareStr } from './text.js';

/** What one analyzer row adds to one dimension. */
export interface AnalyzerContribution {
    dimension: DimensionId;
    /** The tool measured this dimension (after side `ok`). */
    ran: boolean;
    findings: DeltaFinding[];
    metrics: MetricDelta[];
    metricsNotComparable: string[];
    /** C9 reasons (empty = comparable). */
    notComparable: string[];
    /** Other reasons for the dimension (`analyzer-not-measured:<tool>`, `analyzer-pending:<tool>`). */
    reasons: string[];
    measuredBy: MeasuredBy[];
}

export type KindStatus = 'ok' | 'not-comparable' | 'pending';

export interface AnalyzerTier {
    contributions: AnalyzerContribution[];
    /** Kind → whether it could certify the run (for the blocking policy). A static twin that stands keeps its own. */
    status: Map<string, KindStatus>;
    /** Static-tier rule ids the tool measured this run, so the rule does not run. */
    superseded: Set<string>;
}

/** Kind → its tool, over every row. */
export function analyzerKindTools(rows: readonly AnalyzerRule[]): Map<string, string> {
    return new Map(rows.flatMap((r) => Object.keys(r.kinds).map((k) => [k, r.tool] as const)));
}

const failedRun = (tool: string, reason: string): AnalyzerResult => ({ tool, version: '', status: 'failed', reason, findings: [] });

async function ask(ports: DeltaPorts, side: 'before' | 'after', tool: string): Promise<AnalyzerResult> {
    try {
        const r = await ports.analyze!(side, tool);
        if (!r || r.tool !== tool) return failedRun(tool, 'invalid-report');
        return r;
    } catch {
        return failedRun(tool, 'analyzer-threw');
    }
}

/** The side's tool meta for memory `comparable()`: an `ok` run names its version (and data date), a failed one is `failed`, a skipped one is absent. */
function metaOf(r: AnalyzerResult): { tools?: Record<string, string>; failed?: string[] } {
    if (r.status === 'ok') return { tools: { [r.tool]: r.dataAsOf ? `${r.version}@${r.dataAsOf}` : r.version } };
    return r.status === 'failed' ? { failed: [r.tool] } : {};
}

const runOf = (r: AnalyzerResult, side?: 'before' | 'after'): MeasuredBy => ({
    tool: r.tool, version: r.version, status: r.status, ...(r.reason ? { reason: r.reason } : {}), ...(side ? { side } : {}),
    ...(r.producedBy ? { producedBy: r.producedBy } : {}),
});

/** Whole days from `from` to `to` (ISO dates); NaN when either does not parse. */
const daysBetween = (from: string, to: string): number => (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000;

/** The data of an `ok` after side is too old (or undated) for the row. Not checked without `asOf`. */
function stale(row: AnalyzerRule, after: AnalyzerResult, asOf: string | undefined): boolean {
    if (row.maxDataAgeDays === undefined || asOf === undefined) return false;
    if (!after.dataAsOf) return true;
    const age = daysBetween(after.dataAsOf, asOf);
    return !(age <= row.maxDataAgeDays);
}

function dimensionsOf(row: AnalyzerRule): DimensionId[] {
    return [...new Set([...Object.values(row.kinds).map((k) => k.dimension), ...Object.values(row.metrics ?? {})])].sort(compareStr) as DimensionId[];
}

/** The side's findings of one kind; a security kind carries its C5.7 threat as `params.stride` (`tagStride`, never overwritten). */
function ofKind(list: readonly AnalyzerFinding[], kind: string, dimension: DimensionId): AnalyzerFinding[] {
    const own = list.filter((f) => f.kind === kind);
    return dimension === 'security' ? own.map((f) => tagStride(kind, f)) : own;
}

interface RowRun {
    row: AnalyzerRule;
    after?: AnalyzerResult;
    before?: AnalyzerResult;
    /** `pending`: phase 1; `absent`: the host has no analyzer tier. */
    state: 'ran' | 'pending' | 'absent';
}

function contribution(run: RowRun, staticIds: ReadonlySet<string>, scope: LineageScope, asOf: string | undefined, tier: AnalyzerTier): AnalyzerContribution[] {
    const { row, after, before } = run;
    const out = new Map<DimensionId, AnalyzerContribution>(dimensionsOf(row).map((d) => [d, {
        dimension: d, ran: false, findings: [], metrics: [], metricsNotComparable: [], notComparable: [], reasons: [], measuredBy: [],
    }]));
    const each = (fn: (c: AnalyzerContribution) => void) => { for (const c of out.values()) fn(c); };
    const kinds = Object.keys(row.kinds).sort(compareStr);
    /** Kinds this tool alone answers for (a static twin keeps certifying itself when it stands). */
    const own = (kind: string) => !staticIds.has(kind);

    if (run.state === 'pending') {
        each((c) => { c.reasons.push(`analyzer-pending:${row.tool}`); c.measuredBy.push({ tool: row.tool, version: '', status: 'pending' }); });
        for (const kind of kinds) if (own(kind)) tier.status.set(kind, 'pending');
        return [...out.values()];
    }
    if (run.state === 'absent' || !after) {
        each((c) => {
            c.reasons.push(`analyzer-not-measured:${row.tool}`);
            c.measuredBy.push({ tool: row.tool, version: '', status: 'skipped', reason: 'no-analyzer-host' });
        });
        for (const kind of kinds) if (own(kind)) tier.status.set(kind, 'not-comparable');
        return [...out.values()];
    }

    const measured = after.status === 'ok' && (row.sides === 'after' || before?.status === 'ok');
    if (after.status !== 'ok' || (!measured && kinds.some((k) => !own(k)))) {
        // Not measured on the after side — or, for a kind with a static twin, not on both: the twin stands.
        each((c) => {
            c.reasons.push(`analyzer-not-measured:${row.tool}`);
            if (after.status !== 'ok') c.measuredBy.push(runOf(after, 'after'));
            else if (before && before.status !== 'ok') c.measuredBy.push(runOf(before, 'before'));
        });
        if (after.status !== 'ok') {
            for (const kind of kinds) if (own(kind)) tier.status.set(kind, 'not-comparable');
            return [...out.values()];
        }
    }

    const gate = before ? reasonsFor({ id: row.tool, reads: ['content'], producers: [row.tool] }, metaReasons(metaOf(before), metaOf(after))) : [];
    if (stale(row, after, asOf)) gate.push(`analyzer-data-stale:${row.tool}`);
    const comparable = gate.length === 0;
    const beforeFindings = before?.status === 'ok' ? before.findings : [];
    let any = false;
    for (const kind of kinds) {
        if (!own(kind) && !measured) continue; // the static twin stands
        if (!own(kind)) tier.superseded.add(kind);
        any = true;
        const { dimension, version } = row.kinds[kind]!;
        const rule: DeltaRule = { id: kind, version, dimension, reads: ['content'], scope: row.scope ?? 'global', derive: () => ({ before: [], after: [] }) };
        const c = out.get(dimension)!;
        c.findings.push(...findingsOf(rule, { before: ofKind(beforeFindings, kind, dimension), after: ofKind(after.findings, kind, dimension) }, comparable, scope));
        tier.status.set(kind, comparable ? 'ok' : 'not-comparable');
    }

    const beforeMetrics = new Map((before?.status === 'ok' ? before.metrics ?? [] : []).map((m) => [m.metricId, m]));
    for (const m of [...(after.metrics ?? [])].sort((a, b) => compareStr(a.metricId, b.metricId))) {
        const dimension = row.metrics?.[m.metricId];
        if (!dimension) continue;
        any = true;
        const b = row.sides === 'after' ? undefined : beforeMetrics.get(m.metricId);
        const c = out.get(dimension)!;
        c.metrics.push({
            metricId: m.metricId, before: b && b.step === m.step ? b.value : null, after: m.value, step: m.step, unit: m.unit,
            betterWhen: m.betterWhen, threshold: m.threshold,
        });
        if (!comparable) c.metricsNotComparable.push(m.metricId);
    }
    if (any || kinds.length === 0) {
        each((c) => {
            c.ran = true;
            c.notComparable.push(...gate);
            c.measuredBy.push(runOf(after));
            if (measured || row.sides === 'after') return;
            if (before && before.status !== 'ok' && !c.measuredBy.some((m) => m.side === 'before')) c.measuredBy.push(runOf(before, 'before'));
        });
    }
    return [...out.values()];
}

/**
 * The tier for one delta. `staticIds`: the registry's rule and metric ids (a kind among them has a static twin).
 * Phase 1 (`pending`) asks nothing; without an `analyze` port only rows that hold a `blocking` kind report (not measured).
 */
export async function analyzerTier(
    rows: readonly AnalyzerRule[], ports: DeltaPorts, scope: LineageScope,
    opts: ComputeOptions & { staticIds: ReadonlySet<string>; blocking: ReadonlySet<string> },
): Promise<AnalyzerTier> {
    const tier: AnalyzerTier = { contributions: [], status: new Map(), superseded: new Set() };
    const sorted = [...rows].sort((a, b) => compareStr(a.tool, b.tool));
    const runs: RowRun[] = await Promise.all(sorted.map(async (row): Promise<RowRun> => {
        if (opts.analyzers === 'pending') return { row, state: 'pending' };
        if (!ports.analyze) return { row, state: 'absent' };
        const [after, before] = await Promise.all([
            ask(ports, 'after', row.tool),
            row.sides === 'after' ? Promise.resolve(undefined) : ask(ports, 'before', row.tool),
        ]);
        return { row, after, ...(before ? { before } : {}), state: 'ran' };
    }));
    for (const run of runs) {
        // Without a host tier only a row that must certify a blocking kind speaks (fail-closed, naming the tool).
        if (run.state === 'absent' && !Object.keys(run.row.kinds).some((k) => opts.blocking.has(k))) continue;
        tier.contributions.push(...contribution(run, opts.staticIds, scope, opts.asOf, tier));
    }
    return tier;
}
