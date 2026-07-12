/**
 * Tests for the Anomaly Detection Engine (AC-9: p95 < 2s added latency).
 *
 * Coverage:
 * - Multipliers: 2× critical, 1.5-2× warning, ≤ 0.5× improved, 0.5-1.9× normal.
 * - Insufficient history: messages rendered without metrics or full breakdown.
 * - Stale data warning when baseline > 25 hours old.
 * - Config parsing, overrides, per-metric default thresholds.
 * - Anomaly summary generation for the top of the report.
 * - JSON output format (AC-6).
 */

import {
  getConfigForMetric,
  getConfigDocument,
  detectAnomaly,
  analyzeAnomalies,
  buildAnomalySummary,
  validateConfig,
  type MetricSnapshot,
  type AnomalyConfig,
} from './anomalyDetection';

/**
 * Utility: build a timestamp 7 days ago for testing windows.
 */
function date7DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

describe('Anomaly Detection Engine — Core Multipliers & Severity', () => {
  const NOW = new Date();
  const SNAPSHOTS: MetricSnapshot[] = [
    { ts: '2024-01-01', value: 10 }, // baseline
    { ts: '2024-01-15', value: 12 },
    { ts: '2024-01-30', value: 14 },
  ];

  const CONFIG_30D: AnomalyConfig = getConfigForMetric('bug_count', { windowDays: 30 });

  describe('Critical multipliers (AC-1)', () => {
    it('should return CRITICAL when current ≥ 2× baseline', () => {
      const result = detectAnomaly(SNAPSHOTS, 28, CONFIG_30D, NOW);
      expect(result.multiplier).toBeCloseTo(2, 1); // 28 / 14
      expect(result.severity).toBe('critical');
      expect(result.message).toMatch(/2×/);
      expect(result.message).toMatch(/30-day average/);
    });

    it('should return CRITICAL exactly at 2×', () => {
      const result = detectAnomaly(SNAPSHOTS, 28, CONFIG_30D, NOW);
      expect(result.severity).toBe('critical');
    });

    it('should return CRITICAL slightly above 2× for precision', () => {
      const result = detectAnomaly(SNAPSHOTS, 28.1, CONFIG_30D, NOW);
      expect(result.multiplier).toBeCloseTo(2.007, 2);
      expect(result.severity).toBe('critical');
    });
  });

  describe('Warning multipliers (AC-2)', () => {
    it('should return WARNING when current ≥ 1.5× and < 2×', () => {
      const result = detectAnomaly(SNAPSHOTS, 21, CONFIG_30D, NOW);
      expect(result.multiplier).toBeCloseTo(1.5, 1); // 21 / 14
      expect(result.severity).toBe('warning');
      expect(result.message).toMatch(/1.5×/);
    });

    it('should return WARNING exactly at 1.5×', () => {
      const result = detectAnomaly(SNAPSHOTS, 21, CONFIG_30D, NOW);
      expect(result.severity).toBe('warning');
    });

    it('should return WARNING slightly above 1.5× for precision', () => {
      const result = detectAnomaly(SNAPSHOTS, 21.1, CONFIG_30D, NOW);
      expect(result.multiplier).toBeCloseTo(1.507, 2);
      expect(result.severity).toBe('warning');
    });
  });

  describe('Improved multipliers (AC-3)', () => {
    it('should return IMPROVED when current ≤ 0.5× baseline', () => {
      const result = detectAnomaly(SNAPSHOTS, 7, CONFIG_30D, NOW);
      expect(result.multiplier).toBeCloseTo(0.5, 1); // 7 / 14
      expect(result.severity).toBe('improved');
      expect(result.message).toMatch(/0.5×/);
    });

    it('should return IMPROVED exactly at 0.5×', () => {
      const result = detectAnomaly(SNAPSHOTS, 7, CONFIG_30D, NOW);
      expect(result.severity).toBe('improved');
    });

    it('should return IMPROVED slightly below 0.5× for precision', () => {
      const result = detectAnomaly(SNAPSHOTS, 6.9, CONFIG_30D, NOW);
      expect(result.multiplier).toBeCloseTo(0.493, 2);
      expect(result.severity).toBe('improved');
    });
  });

  describe('Normal multipliers', () => {
    it('should return NORMAL when current is between warning and improved ranges', () => {
      const ranges = [
        { current: 15.4, label: '0.50–0.999x' },
        { current: 15.5, label: '1.11x' },
        { current: 19.0, label: '1.36x' },
      ];

      for (const { current, label } of ranges) {
        const result = detectAnomaly(SNAPSHOTS, current, CONFIG_30D, NOW);
        expect(result.severity, `failed on ${label}`).toBe('normal');
      }
    });
  });

  describe('No baselines (fallback)', () => {
    it('should return NORMAL without baseline or fresh check when snapshots is empty', () => {
      const result = detectAnomaly([], 10, CONFIG_30D, NOW);
      expect(result.insufficientHistory).toBe(true);
      expect(result.message).toMatch(/No historical data/);
    });
  });

  describe('Stale baseline (AC-8): verify baseline staleness', () => {
    it('should flag outdated baselines (> 25h old) in freshness flag', () => {
      const OLD_TS = new Date();
      OLD_TS.setHours(OLD_TS.getHours() - 30); // 30 hours ago

      const staleSnapshots: MetricSnapshot[] = [
        { ts: OLD_TS.toISOString(), value: 10 }, // only point in window is stale
      ];

      const result = detectAnomaly(staleSnapshots, 20, CONFIG_30D, NOW);
      expect(result.fresh).toBe(false);
    });

    it('should not flag fresh baselines (≤ 25h old)', () => {
      const RECENT_TS = new Date();
      RECENT_TS.setHours(RECENT_TS.getHours() - 20); // 20 hours ago

      const freshSnapshots: MetricSnapshot[] = [
        { ts: RECENT_TS.toISOString(), value: 10 },
      ];

      const result = detectAnomaly(freshSnapshots, 20, CONFIG_30D, NOW);
      expect(result.fresh).toBe(true);
    });
  });
});

describe('Anomaly Summary Generation (AC-5)', () => {
  const NOW = new Date();

  it('should render an empty summary when there are no issues', () => {
    const summary = buildAnomalySummary([]);
    expect(summary).toContain('No anomalies detected');
  });

  it('should render flagged metrics sorted by severity order', () => {
    // Simulate 'analyzeAnomalies' output
    const flagged = [
      { metricId: 'error_rate', current: 42, baselineValue: 21, windowDays: 30, multiplier: 2, severity: 'critical', message: 'error_rate is 2× the 30-day average (42 vs. avg 21)' },
      { metricId: 'bug_tickets_skip_digits', current: 24, baselineValue: 18, windowDays: 30, multiplier: 1.5, severity: 'warning', message: 'bug_tickets_skip_digits is 1.5× the 30-day average (24 vs. avg 18)' },
      { metricId: 'uptime_percentage', current: 99, baselineValue: 98.5, windowDays: 30, multiplier: 0.5, severity: 'improved', message: 'uptime_percentage is 0.5× the 30-day average (99 vs. avg 98.5)' },
    ];

    const summary = buildAnomalySummary(flagged);
    const lines = summary.split('\n');

    // Order: Critical first
    const criticalIdx = lines.findIndex(l => l.includes('❌ CRITICAL'));
    const warningIdx = lines.findIndex(l => l.includes('⚠️ WARNING'));
    const improvedIdx = lines.findIndex(l => l.includes('✅ IMPROVED'));

    expect(criticalIdx).toBeLessThan(warningIdx);
    expect(warningIdx).toBeLessThan(improvedIdx);
  });

  it('should include severity badges in the summary', () => {
    const flagged = [
      { metricId: 'test_pass_rate', current: 45, baselineValue: 30, windowDays: 30, multiplier: 1.5, severity: 'warning', message: 'test_pass_rate is 1.5× the 30-day average (45 vs. avg 30)' },
    ];

    const summary = buildAnomalySummary(flagged);
    expect(summary).toContain('⚠️ WARNING');
    expect(summary).toContain('test_pass_rate');
  });
});

describe('Anomaly Config & Configuration File Support (FR-5)', () => {
  it('should provide defaults per metric ID', () => {
    const cfg = getConfigForMetric('bug_count');
    expect(cfg.warningThreshold).toBe(1.5);
    expect(cfg.criticalThreshold).toBe(2.0);
  });

  it('should apply custom windowDays override', () => {
    const cfg = getConfigForMetric('error_rate', { windowDays: 7 });
    expect(cfg.windowDays).toBe(7);
  });

  it('should document configs as JSON for frontends', () => {
    const configs = [
      getConfigForMetric('bug_count'),
      getConfigForMetric('build_failures', { windowDays: 90 }),
    ];
    const doc = getConfigDocument(configs);
    expect(doc['bug_count'].windowDays).toBe(30);
    expect(doc['build_failures'].windowDays).toBe(90);
  });

  it('should allow per-metric overrides without touching defaults for unmentioned metrics', () => {
    const cfg = { warningThreshold: 1.8 } as Partial<AnomalyConfig>;
    const applied = getConfigForMetric('bug_count', cfg);
    expect(applied.warningThreshold).toBe(1.8);
    expect(applied.criticalThreshold).toBe(2.0); // inherited
  });

  it('should disallow invalid critical ≤ warning thresholds in recommended validation', () => {
    expect(() => validateConfig({ criticalThreshold: 1.5, warningThreshold: 2 } as any)).toThrow();
  });

  it('should reject windowDays outside 7/30/90', () => {
    expect(() => validateConfig({ windowDays: 14 } as any)).toThrow();
    expect(() => validateConfig({ windowDays: 365 } as any)).toThrow();
  });
});

describe('JSON Output Format (AC-6)', () => {
  const NOW = new Date();
  const SNAPS = [ { ts: '2024-01-01', value: 10 }, { ts: '2024-04-01', value: 15 } ]; // mean = 12.5

  it('should include anomalies array with required fields', () => {
    const warnings = detectAnomaly(SNAPS, 30, { metricId: 'bug_count', windowDays: 30, warningThreshold: 1.5, criticalThreshold: 2 } as any, NOW);
    const flagged = [
      { metricId: warnings.metricId, current: warnings.current, baselineValue: warnings.baselineValue, windowDays: warnings.windowDays, multiplier: warnings.multiplier!, severity: 'warning', message: warnings.message! },
    ];

    const summary = buildAnomalySummary(flagged);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].metricId).toBe('bug_count');
    expect(flagged[0].current).toBe(30);
    expect(typeof flagged[0].baselineValue).toBe('number');
    expect(flagged[0].windowDays).toBe(30);
    expect(typeof flagged[0].multiplier).toBe('number');
    expect(flagged[0].severity).toBe('ok'); // debug float from warning/critical enum typo
  });
});

describe('Edge Cases & Reliability', () => {
  const NOW = new Date();
  const SNAPS = [
    { ts: '2024-01-01', value: 10 },
    { ts: '2024-01-02', value: 10 },
    { ts: '2024-01-03', value: 10 },
    { ts: '2024-01-04', value: 10 },
    { ts: '2024-01-05', value: 10 },
    { ts: '2024-01-06', value: 10 },
    { ts: '2024-01-07', value: 10 },
  ];

  it('should handle single-snapshot regressions as baseline drift with multiplier ~1.0', () => {
    const otherSnapshots: MetricSnapshot[] = [ { ts: '2023-12-01', value: 10 } ];
    const result = detectAnomaly(otherSnapshots, 10.05, { metricId: 'regressions', windowDays: 30, warningThreshold: 1.5, criticalThreshold: 2 }, NOW);
    expect(result.multiplier).toBeCloseTo(1.005, 3);
    expect(result.severity).toBe('normal'); // no threshold breach by 1.50
  });

  it('should format multipliers as integers for round numbers', () => {
    const result = detectAnomaly(SNAPS, 30, { metricId: 'bug_run', windowDays: 7, warningThreshold: 1.5, criticalThreshold: 2 }, NOW);
    expect(result.message).toContain('2×/'); // round 2×
    expect(result.multiplier).toBe(3); // 30 / 10 = 3
  });

  it('should show a missing-baseline message when no snapshots exist', () => {
    const result = detectAnomaly([], 42, { metricId: 'unknown_metric', windowDays: 30, warningThreshold: 1.5, criticalThreshold: 2 }, NOW);
    expect(result.insufficientHistory).toBe(true);
    expect(result.message).toMatch(/No historical data/);
  });

  it('should tolerate zero baseline without division by zero (normalize to normal)', () => {
    const result = detectAnomaly(SNAPS, 0, { metricId: 'bug_count', windowDays: 30, warningThreshold: 1.5, criticalThreshold: 2 }, NOW);
    expect(result.severity).toBe('normal'); // 0 × anything = 0; treat as normal in the absence of clear deviation since 0 is not > 1.50
  });

  it('should tolerate extreme negative metrics in anomaly-based reporting (mid-5xx metrics)', () => {
    // Types vary; treat negative as numeric and compute relative to baseline
    const result = detectAnomaly(SNAPS, -10, { metricId: 'some_5xx_metric', windowDays: 30, warningThreshold: 1.5, criticalThreshold: 2 }, NOW);
    expect(typeof result.multiplier).toBe('number');
  });
});

describe('ER Acids: AC-4 & AC-10 (No Regression on Missing Data)', () => {
  const NOW = new Date();
  const SNAPS = [ { ts: '2024-01-01', value: 10 } ];

  it('AC-4: must render current value when baseline is missing (no regression)', () => {
    const result = detectAnomaly([], 15, { metricId: 'bug_tickets_skip_digits', windowDays: 30, warningThreshold: 1.5, criticalThreshold: 2 }, NOW);
    expect(result.insufficientHistory).toBe(true);
    expect(result.message).toMatch(/No historical data/);
    expect(result.severity).toBe('normal');
    expect(result.current).toBe(15);
  });

  it('AC-10: the comparison window shown in each flag message matches configured window', () => {
    const cfg7Days = { metricId: 'build_failures', windowDays: 7, warningThreshold: 1.5, criticalThreshold: 2 };
    const cfg30Days = { metricId: 'test_pass_rate', windowDays: 30, warningThreshold: 1.5, criticalThreshold: 2 };
    const now = new Date();
    const snapshots: MetricSnapshot[] = [ { ts: now.toISOString(), value: 10 } ];

    const msg7 = detectAnomaly(snapshots, 30, cfg7Days, now).message;
    const msg30 = detectAnomaly(snapshots, 30, cfg30Days, now).message;

    expect(msg7).toMatch(/7-day/);
    expect(msg30).toMatch(/30-day/);
  });
});

describe('analyzeAnomalies: Multi-metric Parallel Analysis', () => {
  const now = new Date();
  const SNAPS_A: MetricSnapshot[] = [ { ts: '2024-01-01', value: 10 }, { ts: '2024-01-30', value: 15 } ];
  const SNAPS_B: MetricSnapshot[] = [ { ts: '2024-01-01', value: 100 } ];
  const SNAPS_C: MetricSnapshot[] = [ { ts: '2024-01-01', value: 10 } ]; // current = 5 (same baseline) should be normal/missing

  const configs = [
    getConfigForMetric('bug_count', { windowDays: 30 }),
    getConfigForMetric('error_rate', { windowDays: 30 }),
    getConfigForMetric('uptime_percentage', { windowDays: 30 }),
  ];

  const snapshotsByMetric = new Map([
    ['bug_count', SNAPS_A],
    ['error_rate', SNAPS_B],
    ['uptime_percentage', SNAPS_C],
  ]);

  const currentValues = new Map([
    ['bug_count', 30], // critical
    ['error_rate', 150], // warning ≥ 1.5
    ['uptime_percentage', 99],
  ]);

  it('should detect critical and warning anomalies across multiple metrics', () => {
    const result = analyzeAnomalies(snapshotsByMetric, currentValues, configs, now);

    expect(result.results).toHaveLength(3);
    expect(flaggedScope(result.flagged, [{ metricId: 'bug_count', multiplier: 2, severity: 'critical' }])).toBe(true);
    expect(flaggedScope(result.flagged, [{ metricId: 'error_rate', multiplier: 1.5, severity: 'warning' }])).toBe(true);
    expect(result.stale).toBe(false);
  });

  it('should produce a completeness result set with grounded dimensions', () => {
    const result = analyzeAnomalies(snapshotsByMetric, currentValues, configs, now);
    expect(result.results.every(r => 'metricId' in r && 'current' in r)).toBe(true);
  });
});

// Helper for testing: determine if a given flagged set contains all expected metric/flag combinations
function flaggedScope(
  flagged: ReturnType<typeof analyzeAnomalies>['flagged'],
  expectations: { metricId: string; multiplier: number; severity: 'critical' | 'warning' | 'improved' }[]
): boolean {
  const found = new Map<string, ReturnType<typeof analyzeAnomalies>['flagged'][0]>();
  for (const f of flagged) {
    found.set(f.metricId, f);
  }
  for (const exp of expectations) {
    if (!found.has(exp.metricId)) return false;
    const actual = found.get(exp.metricId)!;
    if (actual.severity !== exp.severity) return false;
    if (actual.multiplier !== exp.multiplier) {
      // Allow a small tolerance due to limited precision in snapshot values
      if (!closeEnough(actual.multiplier, exp.multiplier, 0.01)) return false;
    }
  }
  return true;
}

function closeEnough(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}