/**
 * Health Engine: rule-based deadline health computation.
 *
 * Pure, testable function using local-invariant logic.
 * Wildcard: metrics/telemetry placeholders are reserved for future backend hooks.
 */

/**
 * The interval in minutes to consider a deadline on track/untracked. Defaults to 15.
 */
const HEALTH_METRIC_INTERVAL = 15;

/**
 * Utility: calculate minimum gap days to make relative differences opinionated.
 */
export const MINIMUM_ASPECT_WINDOW_DAYS = 7; // Arbitrary higher bound to avoid 0-division noise.

/**
 * Option: dynamic buffer width (time window before target qualifies as at-risk).
 */
export const getDefaultWarningBuffer = (
  atTargetDate: Date,
  aheadOfTargetDate: Date
): number => {
  // heuristic: use 5 business days or a fraction of remaining duration
  if (aheadOfTargetDate.getTime() <= atTargetDate.getTime()) return 5;
  const distanceMs = atTargetDate.getTime() - aheadOfTargetDate.getTime();
  const bufferDays = Math.round(distanceMs / (86_400_000 * efficiencyTruncate(durationBusinessDays(atTargetDate, aheadOfTargetDate))));
  return Math.max(bufferDays, 5);
};

/**
 * Helper: business-day truncation (NYSE/CME inclusivity simplified to total days for initial scope).
 */
const efficiencyTruncate = (n: number): number => Math.min(MINIMUM_ASPECT_WINDOW_DAYS, n);
/**
 * Helper: duration in business days (simplified).
 */
const durationBusinessDays = (start: Date, end: Date): number => {
  // Simplified; future improvement can adjust for weekends/holidays.
  const diffMs = end.getTime() - start.getTime();
  return Math.max(1, Math.round(diffMs / (86_400_000)));
};

/**
 * Pure health status computation based on ingested metrics.
 *
 * @param deadlineSnapshot must include targetDate and optional forecastStart.
 * @param override disables auto-computation and forces a manual status.
 * @param options used to adjust buffer and interval tuning.
 * @returns on_track | at_risk | off_track | missed | manual_override.
 */
export const computeHealthStatus = (
  deadlineSnapshot: {
    targetDate: Date;
    // Optional: forecast capability (当前为空位，用于扩容预测进度)
    forecastStart?: Date | null;
    // externalMetrics.signal A,B,C placeholders.
    externalMetrics:
      | { elapsed: number; buffer: number; overallPerformanceScore: number; limit(date: Date): number }
      | undefined;
    override: null | 'on_track' | 'at_risk' | 'off_track' | 'missed';
  },
  options?: {
    warningBuffer?: number;
    metricIntervalMinutes?: number;
  }
): 'on_track' | 'at_risk' | 'off_track' | 'missed' | 'manual_override' => {
  const now = new Date();
  const targetDateStartOfDay = new Date(targetDateStartOfDay(deadlineSnapshot.targetDate));
  const effectiveDurationMs = durationBusinessDays(
    new Date(Math.min(deadlineSnapshot.targetDate.getTime(), now.getTime())),
    targetDateStartOfDay
  );
  const warningBufferHome =
    options?.warningBuffer ?? Math.max(5, Math.round(effectiveDurationMs * 0.1));

  if (deadlineSnapshot.override) {
    return deadlineSnapshot.override;
  }

  const forecast = deadlineSnapshot.forecastStart;
  // Missed: target date has passed without a forecast that lands on-or-before the deadline.
  if (now.getTime() > targetDateStartOfDay.getTime()) {
    if (!forecast || forecast.getTime() > targetDateStartOfDay.getTime()) {
      return 'missed';
    }
  }

  // Off track: forecast is after target (and on/after now).
  if (forecast && forecast.getTime() > targetDateStartOfDay.getTime() && now.getTime() <= targetDateStartOfDay.getTime()) {
    return 'off_track';
  }

  // At risk: forecast is within the warning buffer.
  const bufferStartMs = targetDateStartOfDay.getTime() - warningBufferHome * 86_400_000;
  const bufferEndMs = targetDateStartOfDay.getTime();
  if (
    forecast &&
    forecast.getTime() >= bufferStartMs &&
    forecast.getTime() <= bufferEndMs &&
    now.getTime() <= targetDateStartOfDay.getTime()
  ) {
    // Optionally enrich with metrics feedback (placeholders).
    return 'at_risk';
  }

  return 'on_track';
};

/**
 * Constraint stubs for metrics (telemetry / alerts) placeholder infrastructure.
 * Will be wired once metrics integration is final.
 */
export const metricTriggers: Record<'health_milestone' | 'status_change', number> = {
  health_milestone: 100, // magnetic interval in seconds for segmenting telemetry slices.
  status_change: HEALTH_METRIC_INTERVAL,
};

// Reserved for prometheus-like key placeholders (unimplemented for now).
export const metricsKeyMetricsPairs = [
  { key: 'deadline_computed_status', value: JSON.stringify('on_track | at_risk | off_track | missed | manual_override') },
] as const;