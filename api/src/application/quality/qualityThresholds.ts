/**
 * Quality Health thresholds — defaults + scope-aware resolution.
 *
 * One place owns the default values so the PRD's configurable floors (FR-3.4
 * FR-4.5 FR-5.3 FR-2.4 FR-5.5) are consistent across:
 *   - the backend analytics (gate/score callers)
 *   - frontend threshold UI seeding
 *   - `quality_threshold_configs` table overrides (org / project / team)
 *
 * Resolution order: team → project → org → in-code default.
 * Pure module (no IO) — easy to unit-test and safe to import on the frontend.
 */

export type QualityThresholdScope = 'org' | 'project' | 'team';

/** Every metric key that can have a numeric threshold. */
export type QualityMetricKey =
  | 'open_closed_ratio'   // red when open/closed exceeds this (e.g. 2 means 2:1)
  | 'regression_rate'     // pct alert above this (e.g. 10 = 10%)
  | 'coverage_floor'      // highlight modules below this pct (e.g. 80)
  | 'anomaly_spike_pct'   // day-over-day anomaly flag at this pct increase (e.g. 20)
  | 'coverage_delta'      // PR gate: block when delta drops more than this negative amount (e.g. -2)
  | 'stable_variance_pct' // ± band treated as Stable (default 5 per FR-2.2)
  ;

/** PRD-sourced defaults — the contract AC-3..AC-10 rely on. */
export const DEFAULT_QUALITY_THRESHOLDS: Record<QualityMetricKey, number> = {
  open_closed_ratio:   2,    // FR-3.4
  regression_rate:     10,   // FR-4.5
  coverage_floor:      80,   // FR-5.3
  anomaly_spike_pct:   20,   // FR-2.4
  coverage_delta:      -2,   // FR-5.5 (negative = allowed drop is -2 pp)
  stable_variance_pct: 5,    // FR-2.2 (±5% variance is Stable)
};

export interface QualityThresholdOverride {
  scope_type: QualityThresholdScope;
  scope_id: number | null;   // null = tenant-wide "org"
  metric_key: QualityMetricKey;
  threshold_value: number;
  enabled: boolean;
}

export interface ThresholdResolutionContext {
  orgId?: number | null;
  projectId?: number | null;
  teamId?: number | null;
  /** Raw rows from quality_threshold_configs (already filtered to this tenant). */
  overrides: QualityThresholdOverride[];
}

/**
 * Resolve the effective threshold for one metric + one scope context.
 * Returns `{ value, source }` where `source` is which config won — `default`
 * when nothing matched. Disabled rows are ignored (fall through to next level).
 */
export function resolveQualityThreshold(
  metric: QualityMetricKey,
  ctx: ThresholdResolutionContext,
): { value: number; source: QualityThresholdScope | 'default'; scopeId: number | null } {
  const enabled = ctx.overrides.filter((o) => o.enabled && o.metric_key === metric);

  // team (most specific)
  if (ctx.teamId != null) {
    const row = enabled.find((o) => o.scope_type === 'team' && o.scope_id === ctx.teamId);
    if (row) return { value: row.threshold_value, source: 'team', scopeId: row.scope_id };
  }
  // project
  if (ctx.projectId != null) {
    const row = enabled.find((o) => o.scope_type === 'project' && o.scope_id === ctx.projectId);
    if (row) return { value: row.threshold_value, source: 'project', scopeId: row.scope_id };
  }
  // org (tenant-wide) — stored with scope_id NULL or = orgId
  const orgRow =
    enabled.find((o) => o.scope_type === 'org' && (o.scope_id == null || o.scope_id === ctx.orgId)) ??
    enabled.find((o) => o.scope_type === 'org');
  if (orgRow) return { value: orgRow.threshold_value, source: 'org', scopeId: orgRow.scope_id };

  return { value: DEFAULT_QUALITY_THRESHOLDS[metric], source: 'default', scopeId: null };
}

/** Convenience: resolve every metric at once (for dashboard init payload). */
export function resolveAllQualityThresholds(
  ctx: ThresholdResolutionContext,
): Record<QualityMetricKey, { value: number; source: QualityThresholdScope | 'default'; scopeId: number | null }> {
  const out: Record<string, unknown> = {};
  (Object.keys(DEFAULT_QUALITY_THRESHOLDS) as QualityMetricKey[]).forEach((k) => {
    out[k] = resolveQualityThreshold(k, ctx);
  });
  return out as Record<QualityMetricKey, { value: number; source: QualityThresholdScope | 'default'; scopeId: number | null }>;
}

/** Fast-path helpers so callers that don't need source provenance avoid calling resolve. */
export function openClosedThresholdBreached(ratio: number, threshold: number): boolean {
  return ratio > threshold;
}
export function regressionThresholdBreached(pct: number, threshold: number): boolean {
  return pct > threshold;
}
export function coverageFloorBreached(pct: number, floor: number): boolean {
  return pct < floor;
}
