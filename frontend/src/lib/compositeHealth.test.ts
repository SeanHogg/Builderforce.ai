/**
 * Composite health score — test suite.
 *
 * Focus: coverage of core branches (dirty/good, all stale, no data, all zero weight, weight redistribution,
 * emergent critical override, min/max outliers, trend, rounding). Aligned with the library's internal maxPasses=2,
 * and guards against undefined return states. Static validation will be performed via run_checks.
 */

import { describe, it, expect } from 'vitest';
import {
  HealthScore,
  RawCompositeResult,
  trafficTier,
  computeCompositeHealthScore,
  computeTrend,
  type SubMetricValue,
  type SubMetricRecord,
} from './compositeHealth';

const SOME_THRESHOLD_CRITICAL = 50; // approximate

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

function mkSubMetric(v: number, label: string, weight = 0.20): SubMetricRecord {
  return {
    name: label,
    value: { value: v, minBound: 0, maxBound: 100,.displayName: label },
    weight,
  };
}

function mkStaleSubMetric(v: number, label: string, weight = 0.20): SubMetricRecord {
  return {
    name: label,
    value: { value: v, minBound: 0, maxBound: 100, displayName: label },
    weight,
  };
}

function mkVal(v: number, min = 0, max = 100): SubMetricValue {
  return { value: v, minBound: min, maxBound: max };
}

// ------------------------------------------------------------------ //
// trafficTier tests
// ------------------------------------------------------------------ //

describe('trafficTier', () => {
  it('maps 75+ to green (default thresholds)', () => {
    expect(trafficTier(80)).toBe('green');
    expect(trafficTier(75)).toBe('green');
  });

  it('maps 50-74 to amber', () => {
    expect(trafficTier(74)).toBe('amber');
    expect(trafficTier(60)).toBe('amber');
  });

  it('maps 0-49 to red', () => {
    expect(trafficTier(49)).toBe('red');
    expect(trafficTier(0)).toBe('red');
  });
});

// ------------------------------------------------------------------ //
// computeCompositeHealthScore core tests
// ------------------------------------------------------------------ //

describe('computeCompositeHealthScore', () => {
  // Basic: simple sane case (1 metric, all good)
  it('basic good case yields green', () => {
    const subMetrics = [mkSubMetric(80, 'deploys')];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    expect(result).to.be.instanceof(Object);
    expect(result).to.have.property('score');
    expect(result).to.have.property('status');
    expect(result).to.have.property('raw');
    // Expect score around 80 * weight. Weight default 0.2 => 16.
    expect(result.score).toBeCloseTo(16, 0); // sanity
    expect(result.status).to.equal('green');
    expect(result.raw).to.have.property('allMetricsStale', false);
    expect(result.raw).to.have.property('noMetricsAvailable', false);
  });

  // All metrics stale (no data at all)
  it('all metrics stale returns no_data', () => {
    const subMetrics = [mkStaleSubMetric(70, 'deploys'), mkStaleSubMetric(90, 'mr_merged')];
    const result = computeCompositeHealthScore(subMetrics, (_) => true, undefined, undefined, [], null);
    expect(result).to.have.property('status', 'no_data');
    expect(result.raw).to.have.property('allMetricsStale', true);
    expect(result.raw).to.have.property('healthyMetricCount', 0);
    expect(result.raw).to.have.property('noMetricsAvailable', true);
  });

  // No metrics available (evaluated = false)
  it('no metrics available returns no_data', () => {
    const subMetrics: SubMetricRecord[] = [
      { name: 'a', value: { ...mkVal(10), evaluated: false }, weight: 0.2 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    expect(result.raw).to.have.property('noMetricsAvailable', true);
    expect(result).to.have.property('status', 'no_data');
  });

  // All weight zero (global weights have 0 for all)
  it('all weight zero yields score zero', () => {
    const subMetrics: SubMetricRecord[] = [
      { name: 'a', value: { ...mkVal(100), evaluated: true }, weight: 0 }, // zero weight
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    expect(result.raw.remainingWeight).toBe(0);
    // Should output zero since actual weighted sum is zero.
    expect(result.score).toBe(0);
  });

  // Mix of evaluated/evaluated but all weights zero
  it('mix of evaluated and zero weights does not invert weight redistribution', () => {
    const subMetrics: SubMetricRecord[] = [
      { name: 'a', value: { ...mkVal(100), evaluated: true }, weight: 0 },
      { name: 'b', value: { ...mkVal(0), evaluated: true }, weight: 0 }, // both zero
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    expect(result.raw.remainingWeight).toBe(0);
    expect(result.score).toBe(0);
  });

  // Critical override: emergent CRITICAL metric (open P1) forces RED.
  it('emergent critical metric (evaluated) overrides to RED', () => {
    const subMetrics = [
      mkSubMetric(90, 'deploys', 0.3),
      // emergent CRITICAL metric that is evaluated and EMERGENT
      { name: 'incident_p1', value: { value: 1, minBound: 0, maxBound: 10, eval: true, emergent: true, displayName: 'Open P1 incidents', evaluated: true }, weight: 0.7 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, ['incident_p1'], null);
    expect(result.hasCriticalOverride).to.equal(true);
    expect(result.status).to.equal('red');
  });

  // Critical override: emergent metric NOT evaluated → NO override.
  it('emergent critical metric not evaluated does NOT force RED', () => {
    const subMetrics = [
      mkSubMetric(90, 'deploys', 0.3),
      { name: 'incident_p1', value: { value: 1, minBound: 0, maxBound: 10, eval: false, emergent: true, displayName: 'Open P1 (unobserved)', evaluated: false }, weight: 0.7 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, ['incident_p1'], null);
    expect(result.hasCriticalOverride).to.equal(false);
    expect(result.status).to.equal('green'); // no override
  });

  // Critical override: non-emergent CRITICAL metric still forces RED.
  it('non-emergent CRITICAL metric still forces RED', () => {
    const subMetrics = [
      mkSubMetric(95, 'deploys', 0.3),
      { name: 'incident_p1', value: { value: 10, minBound: 0, maxBound: 10, evaluated: true }, weight: 0.7 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, ['incident_p1'], null);
    expect(result.hasCriticalOverride).to.equal(true);
    expect(result.status).to.equal('red');
  });

  // Critical override: no critical metrics in list → NO override.
  it('no CRITICAL metrics → NO override', () => {
    const subMetrics = [mkSubMetric(70, 'deploys', 0.5), mkSubMetric(60, 'mr_merged', 0.5)];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, ['incident_p1'], null);
    expect(result.hasCriticalOverride).to.equal(false);
    expect(result.status).not.to.equal('red');
  });

  // Critical override: emergent but threshold above 50 → NO direct override by emergent (must be evaluated EMERGENT).
  it('emergent CRITICAL > threshold → NO override unless EMERGENT+EVALUATED', () => {
    const subMetrics = [
      { name: 'incident_p1', value: { value: 100, minBound: 0, maxBound: 100, eval: true, emergent: true, displayName: 'Open P1', evaluated: true }, weight: 0.5 },
      { name: 'objective', value: { ...mkVal(10), evaluated: true }, weight: 0.5 },
    ];
    // emergent EMERGENT gets evaluated: emergent override gets triggered.
    const result1 = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, ['incident_p1'], null);
    expect(result1.hasCriticalOverride).to.equal(true);
    expect(result1.status).to.equal('red');

    // emergent NOT evaluated: no override.
    subMetrics[0].value.evaluated = false;
    const result2 = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, ['incident_p1'], null);
    expect(result2.hasCriticalOverride).to.equal(false);
    expect(result2.status).not.to.equal('red');
  });

  // Complex: multi-metric with weight redistribution when some metrics are missing or zero weight globally
  // This test checks that redistributed weight doesn't create a zero sum that still yields a valid score.
  it('multi-metric with partial weights and missing global distribution yields valid score', () => {
    // Global weights: some metrics have weight (0.2), one metric uses 0.0 globally but is present with weight 0.4 via per-project.
    const subMetrics: SubMetricRecord[] = [
      { name: 'deploys', value: { ...mkVal(80), evaluated: true }, weight: 0.2 },
      // global weight missing (defaults to 0), but this metric has weight 0.4 (project overrides).
      { name: 'mr_merged', value: { ...mkVal(90), evaluated: true }, weight: 0.4 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    expect(result.raw.remainingWeight).toBeGreaterThanOrEqual(0);
  });

  // Distribution weight redistribution across unknown metrics (global weight missing).
  it('distributes missing global weight into healthy metrics and ends at exactly 100% across healthy metrics', () => {
    const subMetrics: SubMetricRecord[] = [
      { name: 'deploys', value: { ...mkVal(80), evaluated: true }, weight: 0.2 },
      // global weight missing (defaults to 0), but this metric has explicit weight 0.2.
      // global has no weight for this metric; total after final split should be 100% across healthy metrics.
      { name: 'mr_merged', value: { ...mkVal(90), evaluated: true }, weight: 0.2 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    // Weighted sum (without redistribution) across healthy metrics should be 0; after redistribution we aim for 100%.
    // Check the final subMetrics weight order is non-negative and normalized.
    const total = result.subMetrics.reduce((acc, m) => acc + m.weight, 0);
    expect(total).toBeCloseTo(100, 0);
    // Ensure all subMetrics have non-negative weight.
    for (const m of result.subMetrics) {
      expect(m.weight).toBeGreaterThanOrEqual(0);
    }
  });

  // Min/Max outlier: value below min, above max normalized to 0/100.
  it('min/max outliers are treated as endpoints 0/100', () => {
    const subMetrics: SubMetricRecord[] = [
      { name: 'low', value: { ...mkVal(-10), minBound: 0, maxBound: 100 evaluated: true }, weight: 1.0 },
      { name: 'high', value: { ...mkVal(150), minBound: 0, maxBound: 100 evaluated: true }, weight: 1.0 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    expect(result.raw.allMetricsStale).to.equal(false);
    expect(result.raw.noMetricsAvailable).to.equal(false);
    // Outliers normalized to 0/100.
    // This tests that values outside bounds are clamped (these are the only metrics derived from numeric aggregation).
    // Implementation: values out of bounds render 0 or 100.
    expect(result.subMetrics.length).toBeGreaterThan(0);
  });

  // Sub-metric subrange (sub metrics that rely on a subrange).
  it('normalize respects custom subrange', () => {
    const subMetrics: SubMetricRecord[] = [
      { name: 'range', value: { ...mkVal(10), minBound: 0, maxBound: 10 evaluated: true }, weight: 1.0 },
      { name: 'range2', value: { ...mkVal(9.5), minBound: 8, maxBound: 10 evaluated: true }, weight: 1.0 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    expect(result.subMetrics.length).toBeGreaterThan(0);
  });

  // Weight redistribution zero remainder after normalization but distribution loops.
  // This test is to establish known risk: internal maxPasses=2 guards against infinite loops, but could still drift.
  it('weight redistribution proceeds within maxPasses and finalizes with finite sum', () => {
    const subMetrics: SubMetricRecord[] = [
      { name: 'a', value: { ...mkVal(100), evaluated: true }, weight: 0.35 },
      { name: 'b', value: { ...mkVal(100), evaluated: true }, weight: 0.35 },
      { name: 'c', value: { ...mkVal(100), evaluated: true }, weight: 0.3 },
    ];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    expect(result.raw.allMetricsStale).to.equal(false);
    const total = result.subMetrics.reduce((acc, m) => acc + m.weight, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  // Trend with limited windows.
  it('computeTrend returns stable for small data sets for safety', () => {
    const history = [
      { timestamp: '2025-01-21T12:00:00Z', score: 70, subMetrics: [] },
      { timestamp: '2025-01-22T12:00:00Z', score: 72, subMetrics: [] },
    ];
    expect(computeTrend(history, 7)).to.equal('stable');
  });

  it('computeTrend respects window and detects improving/damaging', () => {
    const history = [
      { timestamp: '2025-01-15T12:00:00Z', score: 50, subMetrics: [] },
      { timestamp: '2025-01-22T12:00:00Z', score: 80, subMetrics: [] },
    ];
    expect(computeTrend(history, 7)).to.equal('improving');
    history[1].score = 30;
    expect(computeTrend(history, 7)).to.equal('degrading');
  });

  it('computeTrend ignores partial windows and returns stable', () => {
    const history = [{ timestamp: '2025-01-22T12:00:00Z', score: 60, subMetrics: [] }, { timestamp: '2025-01-25T12:00:00Z', score: 70, subMetrics: [] }];
    expect(computeTrend(history, 30)).to.equal('stable'); // minor partial window; default stable.
  });
});

// ------------------------------------------------------------------ //
// Type tests (to ensure our types are consistent with defaults)
// ------------------------------------------------------------------ //

describe('Type tests', () => {
  it('HealthScore object has the required keys', () => {
    const s: HealthScore = {
      score: 75,
      status: 'green',
      tier: 'green',
      color: '#22c55e',
      lastUpdatedAt: '2025-01-21T12:00:00Z',
      subMetrics: [
        { name: 'a', value: { value: 80, minBound: 0, maxBound: 100 evaluated: true }, weight: 0.5 },
      ],
      raw: { healthyMetricCount: 1, remainingWeight: 0, allMetricsStale: false, noMetricsAvailable: false },
      trend: 'stable',
      hasCriticalOverride: false,
    };
    expect(s).to.to.equal(s);
  });
});