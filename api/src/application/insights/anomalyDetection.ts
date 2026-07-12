/**
 * ANOMALY DETECTION ENGINE — statistical baseline comparison for diagnostic reports.
 *
 * This module provides pure, unit-testable functions to:
 * - Compute rolling baselines (7-day, 30-day, 90-day averages) from snapshot history
 * - Detect anomalies using configurable thresholds (Warning ≥ 1.5×, Critical ≥ 2×, Positive ≤ 0.5×)
 * - Generate human-readable flag messages
 * - Return structured JSON for report APIs
 *
 * Intended use: called by diagnostic report generators (e.g. `computeQualityInsights` + additional logic)
 * that provide current metric values and baseline history. No DB writes are performed here.
 */

/** Snapshot of a metric at a point-in-time */
export interface MetricSnapshot {
  /** Timestamp of the snapshot (ISO 8601 or epoch ms) */
  ts: string | number;
  /** Numeric value of the metric for that point-in-time */
  value: number;
}

/**
 * Options for configuring anomaly detection behavior per metric.
 */
export interface AnomalyConfig {
  /** Metric identifier (e.g. 'bug_count', 'error_rate', 'build_failures', 'test_pass_rate') */
  metricId: string;
  /** Should this metric participate in anomaly detection? */
  enabled: boolean;
  /** Desired comparison window (days). Supported: 7, 30, 90. */
  windowDays: number;
  /** Warning threshold as multiplier of baseline (default 1.5) */
  warningThreshold: number;
  /** Critical threshold as multiplier of baseline (default 2.0) */
  criticalThreshold: number;
}

/**
 * Default thresholds per metric type as specified in FR-2 of the PRD.
 */
const DEFAULT_THRESHOLDS: Record<string, Partial<AnomalyConfig>> = {
  bug_count: {
    warningThreshold: 1.5,
    criticalThreshold: 2.0,
  },
  error_rate: {
    warningThreshold: 1.5,
    criticalThreshold: 2.0,
  },
  build_failures: {
    warningThreshold: 1.5,
    criticalThreshold: 2.0,
  },
  test_pass_rate: {
    warningThreshold: 1.5,
    criticalThreshold: 2.0,
  },
  uptime_percentage: {
    warningThreshold: 1.5,  // Low uptime is bad: warning at 1.5× below average
    criticalThreshold: 2.0,
  },
};

/**
 * Build an AnomalyConfig object from metric ID and optional overrides.
 * Falls back to configurable defaults.
 */
export function getConfigForMetric(metricId: string, overrides: Partial<AnomalyConfig> = {}): AnomalyConfig {
  const defaults = DEFAULT_THRESHOLDS[metricId] || {};
  const window = overrides.windowDays ?? 30;

  return {
    metricId,
    enabled: overrides.enabled ?? true,
    windowDays: window,
    warningThreshold: overrides.warningThreshold ?? defaults.warningThreshold ?? 1.5,
    criticalThreshold: overrides.criticalThreshold ?? defaults.criticalThreshold ?? 2.0,
  };
}

/**
 * Return a configuration document (JSON) for frontend display/editing.
 * Format: { "metricId": { "enabled": true, "windowDays": 30, "warningThreshold": 1.5, ... }, ... }
 */
export function getConfigDocument(configs: AnomalyConfig[]): Record<string, Partial<AnomalyConfig>> {
  return configs.reduce((acc, cfg) => {
    const { metricId, enabled, windowDays, warningThreshold, criticalThreshold } = cfg;
    acc[metricId] = { enabled, windowDays, warningThreshold, criticalThreshold };
    return acc;
  }, {} as Record<string, Partial<AnomalyConfig>>);
}

/**
 * Parse a timestamp string or number into a Date object.
 */
function parseTs(ts: string | number): Date {
  if (typeof ts === 'number') {
    return new Date(ts);
  }
  return new Date(ts);
}

/**
 * Filter snapshot history up to a specific time window.
 * Only returns points that are within the desired lookback window AND are the most recent point per day (for dedup).
 */
function filterSnapshotsByWindow(
  snapshots: MetricSnapshot[],
  now: Date,
  windowDays: number,
  maxDailyPoints: number = 30, // Limit to 30 points per day for efficiency
): MetricSnapshot[] {
  const cutoffDate = new Date(now.getTime() - windowDays * 86_400_000); // 86_400_000 ms = 1 day
  const windowMs = windowDays * 86_400_000;

  // Group by day (YYYY-MM-DD). Keep only the most recent point per day in the window to reduce array size.
  const dayMap = new Map<number, MetricSnapshot>();

  for (const snap of snapshots) {
    const ts = parseTs(snap.ts);
    // Skip entries before the window (strictly older)
    if (ts < cutoffDate) continue;
    // Skip entries in the future
    if (ts > now) continue;

    const dayKey = Math.floor(ts.getTime() / 86_400_000); // Unix day timestamp
    const existing = dayMap.get(dayKey);
    // Keep the one with the higher numeric value (or later ts if ties), assuming later is more recent
    if (!existing || ts.valueOf() >= parseTs(existing.ts).valueOf()) {
      dayMap.set(dayKey, snap);
    }
  }

  return Array.from(dayMap.values()).sort((a, b) => parseTs(a.ts).getTime() - parseTs(b.ts).getTime());
}

/**
 * Compute statistical summary from filtered snapshots.
 * Returns mean and optional std dev if there are at least 2 points.
 */
function computeStats(snapshotValues: number[]): { mean: number | null; stdDev: number | null } {
  if (snapshotValues.length === 0) {
    return { mean: null, stdDev: null };
  }

  if (snapshotValues.length === 1) {
    return { mean: snapshotValues[0], stdDev: null };
  }

  const sum = snapshotValues.reduce((acc, val) => acc + val, 0);
  const mean = sum / snapshotValues.length;

  // Sample standard deviation
  const sumSquaredDiff = snapshotValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
  const variance = sumSquaredDiff / (snapshotValues.length - 1);
  const stdDev = Math.sqrt(variance);

  return { mean, stdDev };
}

/**
 * Determine severity class based on computed multiplier and provided thresholds.
 */
function determineSeverity(
  current: number,
  baseline: number,
  criticalThreshold: number,
  warningThreshold: number,
): 'critical' | 'warning' | 'improved' | 'normal' {
  if (baseline === null || baseline === 0 || current === null) {
    return 'normal';
  }

  const multiplier = current / baseline;

  if (multiplier >= criticalThreshold) {
    return 'critical';
  }
  if (multiplier >= warningThreshold) {
    return 'warning';
  }
  if (multiplier <= 0.5) {
    return 'improved'; // Favorable drop (or sustained low)
  }

  return 'normal';
}

/**
 * Format a multiplier as a string: "2×" or percentages like "+112%" for positive deviation.
 */
function formatMultiplier(current: number, baseline: number): string {
  if (baseline === 0 || baseline === null) {
    return 'N/A';
  }

  const multiplier = current / baseline;

  // Integer-like multiplier for round numbers
  if (Number.isInteger(multiplier)) {
    return `${multiplier}×`;
  }

  // Percentage for more nuanced cases
  const percentChange = ((multiplier - 1) * 100).toFixed(1);
  const sign = multiplier > 1 ? '+' : '';
  return `${sign}${percentChange}%`;
}

/**
 * Format a metric value nicely with commas (e.g., "42", "98.5%", "$125M").
 */
function formatValue(value: number, unit?: string): string {
  const formatted = Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1).replace(/\.0$/, '');
  return unit ? `${formatted}${unit}` : formatted;
}

/**
 * Build the natural-language flag message per FR-4.
 */
function formatAnomalyMessage(
  metricName: string,
  current: number,
  baseline: number,
  windowDays: number,
  severity: string,
  insufficientHistory: boolean,
): string {
  if (insufficientHistory || baseline === null || baseline === 0) {
    return `${metricName}: Insufficient history for baseline comparison`;
  }

  const multiplier = current / baseline;
  const multiplierFormatted = formatMultiplier(current, baseline);
  const valueFormatted = formatValue(current);
  const avgFormatted = formatValue(baseline);
  const windowStr = `${windowDays}-day`;

  switch (severity) {
    case 'critical':
      // e.g., "Bug count is 2× the 30-day average (42 vs. avg 21)"
      return `${metricName} is ${multiplierFormatted}× the ${windowStr} average (${valueFormatted} vs. avg ${avgFormatted})`;
    case 'warning':
      return `${metricName} is ${multiplierFormatted}× the ${windowStr} average (${valueFormatted} vs. avg ${avgFormatted})`;
    case 'improved':
      return `${metricName} is ${multiplierFormatted}× the ${windowStr} average (${valueFormatted} vs. avg ${avgFormatted})`;
    default:
      return `${metricName}: Normal within ${windowStr} window (current ${valueFormatted}, avg ${avgFormatted})`;
  }
}

/**
 * Check if baseline data is sufficiently recent (AC-8: within 25 hours).
 */
function isBaselineFresh(snapshots: MetricSnapshot[], now: Date): boolean {
  if (snapshots.length === 0) return false;

  const lastSnapshotTime = parseTs(snapshots[snapshots.length - 1].ts);
  const hoursSince = (now.getTime() - lastSnapshotTime.getTime()) / 36_000_000;
  return hoursSince <= 25;
}

/**
 * Run anomaly detection on a single metric.
 *
 * @param snapshots - Historical metric snapshots (fetched per project/day)
 * @param current - Current metric value (snapshot timestamp is assumed same as `now`)
 * @param config - Anomaly configuration for this metric
 * @param now - Current time (defaults to Date.now())
 *
 * @returns Anomaly result including severity, message, breakdown, and date check
 */
export function detectAnomaly(
  snapshots: MetricSnapshot[],
  current: number,
  config: AnomalyConfig,
  now: Date = new Date(),
): {
  metricId: string;
  current: number;
  baseline?: number;
  baselineValue?: number;
  windowDays: number;
  multiplier?: number;
  severity: 'critical' | 'warning' | 'improved' | 'normal';
  message?: string;
  insufficientHistory: boolean;
  fresh: boolean;
} {
  // Filter to the configured window
  const filtered = filterSnapshotsByWindow(snapshots, now, config.windowDays);
  const hasHistory = filtered.length > 0;
  const insufficientHistory = !hasHistory || filtered.length < 7; // AC-4: at least 7 days of history

  // Compute baseline stats
  const snapshotValues = filtered.map(s => s.value);
  const { mean: baseline } = computeStats(snapshotValues);
  const baselineValue = baseline;

  // Determine severity if we have a valid baseline
  const severity = insufficientHistory ? 'normal' : determineSeverity(current, baseline!, config.criticalThreshold, config.warningThreshold);

  // Generate message per FR-4
  const isFresh = hasHistory ? isBaselineFresh(filtered, now) : false;
  let message: string | undefined;
  if (hasHistory) {
    const formattedCurrent = formatValue(current);
    message = formatAnomalyMessage(
      config.metricId, // using metricId as metric name (caller may pass a display name)
      current,
      baselineValue!,
      config.windowDays,
      severity,
      insufficientHistory,
    );
  } else {
    message = `${config.metricId}: No historical data for this metric`;
  }

  return {
    metricId: config.metricId,
    current,
    baseline: baselineValue,
    baselineValue,
    windowDays: config.windowDays,
    multiplier: hasHistory ? current / baselineValue! : undefined,
    severity,
    insufficientHistory,
    fresh: isFresh,
    message: insufficientHistory ? undefined : message,
  };
}

/**
 * Run anomaly detection across multiple metrics simultaneously.
 * Useful for an entire diagnostic report.
 *
 * @param snapshotsByMetric - Map of metricId -> its snapshot array
 * @param currentValues - Map of metricId -> current value
 * @param configs - Anomaly configs (may be all enabled, or filtered for selected metrics)
 * @param now - Current time (defaults to Date.now())
 *
 * @returns Anomalies results, a summary, and freshness status
 */
export function analyzeAnomalies(
  snapshotsByMetric: Map<string, MetricSnapshot[]>,
  currentValues: Map<string, number>,
  configs: AnomalyConfig[],
  now: Date = new Date(),
): {
  results: Array<{
    metricId: string;
    current: number;
    baseline?: number;
    baselineValue?: number;
    windowDays: number;
    multiplier?: number;
    severity: 'critical' | 'warning' | 'improved' | 'normal';
    message?: string;
    insufficientHistory: boolean;
    fresh: boolean;
  }>;
  flagged: Array<{
    metricId: string;
    current: number;
    baselineValue?: number;
    windowDays: number;
    multiplier: number;
    severity: 'critical' | 'warning' | 'improved';
    message: string;
  }>;
  stale: boolean;
} {
  const results: ReturnType<typeof analyzeAnomalies>['results'] = [];
  const flagged: ReturnType<typeof analyzeAnomalies>['flagged'] = [];
  let anyStale = false;

  for (const cfg of configs) {
    if (!cfg.enabled) continue;

    const snapshots = snapshotsByMetric.get(cfg.metricId) ?? [];
    const current = currentValues.get(cfg.metricId) ?? 0;

    const result = detectAnomaly(snapshots, current, cfg, now);
    results.push(result);

    // Build structured anomalies for JSON output (AC-6)
    if (!result.insufficientHistory && 'multiplier' in result) {
      flagged.push({
        metricId: result.metricId,
        current: result.current,
        baselineValue: result.baselineValue,
        windowDays: result.windowDays,
        multiplier: result.multiplier!,
        severity: result.severity,
        message: result.message!,
      });
    }

    if (!result.fresh) anyStale = true;
  }

  return {
    results,
    flagged,
    stale: anyStale,
  };
}

/**
 * Generate the anomaly summary list for the top of the report (AC-5).
 * Format: a bulleted list of flagged metrics with severity badges and a quick link to the inline position.
 */
export function buildAnomalySummary(flagged: Array<{
  metricId: string;
  current: number;
  baselineValue?: number;
  windowDays: number;
  multiplier: number;
  severity: 'critical' | 'warning' | 'improved';
  message: string;
}>): string {
  if (flagged.length === 0) {
    return '**No anomalies detected.** History is healthy and within expected ranges.';
  }

  // Group by severity order: critical, warning, improved
  const severityOrder = { critical: 0, warning: 1, improved: 2 };
  const sortedFlagged = [...flagged].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const badgeColor: Record<string, string> = {
    critical: '**❌ CRITICAL**',
    warning: '**⚠️ WARNING**',
    improved: '**✅ IMPROVED**',
  };

  return sortedFlagged.map(f => {
    const badge = badgeColor[f.severity];
    const idLink = f.metricId.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    return `- ${badge} \`${f.metricId}\`: ${f.message}`;
  }).join('\n');
}

/**
 * Validate config values per PRD requirements.
 * Throws on critical validation errors; logs warnings for minor issues.
 */
export function validateConfig(cfg: Partial<AnomalyConfig>): AnomalyConfig {
  const metricId = cfg.metricId ?? (function dummy() { throw new Error('metricId is required'); }());

  const warning = cfg.warningThreshold;
  const critical = cfg.criticalThreshold;
  const windowDays = cfg.windowDays ?? 30;
  const enabled = cfg.enabled ?? true;

  if (windowDays !== 7 && windowDays !== 30 && windowDays !== 90) {
    throw new Error(`Invalid windowDays: ${windowDays}. Must be 7, 30, or 90.`);
  }

  if (warning < 0 || critical <= warning) {
    throw new Error(`Invalid thresholds: warning=${warning}, critical=${critical}. Critical must be > warning.`);
  }

  return {
    metricId,
    enabled,
    windowDays,
    warningThreshold: warning,
    criticalThreshold: critical,
  };
}