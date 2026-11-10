/**
 * contract/analyzers.ts — the L3 analyzer half of THE run delta contract (PRD 41 §B7, §C4, §C9): what a host's
 * analyzer tier hands the engine through {@link DeltaPorts.analyze}, the registry rows that say what each tool
 * measures, and the options of one engine call. Pure types; re-exported from `contract.ts`.
 */

import type { DimensionId, MetricDelta, RuleFinding } from '../contract.js';

/** How one analyzer run ended on one side. `skipped`: the tool is not bundled or present here (never started). */
export type AnalyzerStatus = 'ok' | 'failed' | 'skipped';

/** One finding an analyzer reported on one side, normalized by its adapter: a rule finding plus its kind (the rule id it is reported under). */
export interface AnalyzerFinding extends RuleFinding {
    kind: string;
}

/** One analyzer measurement on one side (e.g. `coverage.diff`): `value` is an integer of `step` (B8.2). */
export interface AnalyzerMetric {
    metricId: string;
    value: number;
    step: number;
    unit: string;
    betterWhen: 'lower' | 'higher';
    threshold: MetricDelta['threshold'];
}

/**
 * What one analyzer gave on one side ({@link DeltaPorts.analyze}). Adapters SORT and canonicalize their
 * output (B8.1), so the same tree gives the same result. A tool that failed or was skipped has no
 * findings: its kinds are `not_measured`, never zero findings.
 */
export interface AnalyzerResult {
    tool: string;
    /** The tool's own version (C9: a change between the sides makes its kinds `not_comparable`); `''` when it never started. */
    version: string;
    status: AnalyzerStatus;
    /** A stable code for a `failed`/`skipped` run (`tool-absent`, `analyzer-unavailable`, `timeout`, `invalid-report`, `no-coverage`, …). */
    reason?: string;
    /**
     * The date (ISO `YYYY-MM-DD`) of the data the tool measured against — osv-scanner's offline vulnerability database.
     * Checked against {@link AnalyzerRule.maxDataAgeDays}.
     */
    dataAsOf?: string;
    /**
     * Provenance: the dynamic-tier check whose run left what this analyzer measured (`diff-coverage` for the `coverage`
     * row it re-measures after the tier's tests). Absent: the analyzer measured the tree as it was. Carried onto the
     * {@link MeasuredBy} row, so D9.1 credit (leave-one-out) can remove everything a check produced.
     */
    producedBy?: string;
    findings: AnalyzerFinding[];
    metrics?: AnalyzerMetric[];
}

/**
 * One L3 analyzer ROW (B7, registry data): the tool the host runs and what its output measures. Each declared kind is
 * reported under the rule id = the kind; a finding of an undeclared kind is dropped.
 *
 * A kind that is ALSO a static-tier rule id (`clone-group`, `unused-*`: they read the last review's graph) is superseded
 * by the tool only when the tool measured this run: `ok` on the after side, and on the before side when that is asked.
 * Otherwise the static rule stands and the tool's run says why it did not measure (`analyzer-not-measured:<tool>`).
 *
 * Comparability (C9) gates every kind on the tool through the `producers` mechanism: a version change, a failure or an
 * absence on the before side, or data older than {@link maxDataAgeDays}, make it `not_comparable`; an after side that
 * did not run makes it `not_measured`.
 */
export interface AnalyzerRule {
    /** The tool name: what `analyze` runs, the C9 producer of its kinds, and `MeasuredBy.tool`. */
    tool: string;
    /** Kind → its dimension and the adapter's normalization version (`DeltaFinding.ruleVersion`). */
    kinds: Readonly<Record<string, { dimension: DimensionId; version: number }>>;
    /** Metric id → its dimension. */
    metrics?: Readonly<Record<string, DimensionId>>;
    /** C2, as `DeltaRule.scope`. Default `global` (whole-tree tools). */
    scope?: 'impact' | 'global';
    /** `after`: the tool measures only the run's after side (changed-line coverage): `before` is never asked, metrics have `before: null`. */
    sides?: 'both' | 'after';
    /**
     * The oldest {@link AnalyzerResult.dataAsOf} that still counts (C5.4: the offline vulnerability database, 14 days).
     * Older, or undated, data makes the kinds `not_comparable` (`analyzer-data-stale:<tool>`); the rest of the dimension still reports.
     */
    maxDataAgeDays?: number;
}

/** Options of one `computeRunDelta` call. */
export interface ComputeOptions {
    /**
     * `pending` (phase 1 of the §6 "Agent run" sequence): the static tier only. `analyze` is not asked; every analyzer row
     * is reported `pending` in `measuredBy`, its dimensions carry `analyzer-pending:<tool>`, and a BLOCKING analyzer kind is
     * the blocking code `analyzer-pending:<tool>` (the hold waits for the final delta). `run` (default): ask `analyze`
     * when the host has it.
     */
    analyzers?: 'run' | 'pending';
    /** Today (ISO `YYYY-MM-DD`), for {@link AnalyzerRule.maxDataAgeDays}: the engine has no clock. Absent ⇒ data age is not checked. */
    asOf?: string;
}
