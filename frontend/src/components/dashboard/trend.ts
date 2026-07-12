/**
 * Trend classification and tooltip data for inline trend arrows (task #307 — Trend Arrows PRD).
 * Pure, hook-free helpers shared by any metrics surface that has at least two comparable data points.
 */

/** Direction (abstract) — arrow abstraction independent of metric polarity. */
export type TrendDirection = 'up' | 'down' | 'flat';

/** Polarity: rising is good (e.g., merge rate, tasks completed) vs. rising is bad (errors, token spend). */
export type MetricPolarity = 'higher-is-better' | 'lower-is-better' | null;

/** Trend state after classifying by threshold and polarity. */
export type TrendState = 'improving' | 'declining' | 'stable';

/** Detail-level tooltip payload. */
export interface TrendTooltip {
  /** Prior period value (raw or formatted). */
  priorValue: string;
  /** Current period value (raw or formatted). */
  currentValue: string;
  /** Absolute delta: +5, -3, or 0. */
  delta: number;
  /** Signed percentage change to one decimal place. */
  pct: number;
  /** Comparison window description (e.g., "vs. previous 14 days"). */
  windowLabel: string;
}

/** Classification outcome with all data needed for rendering. */
export interface TrendClassification {
  /** Direction of movement (abstract). */
  direction: TrendDirection;
  /** Resulting state (semi-polarized: color based on polarity + direction). */
  state: TrendState;
  /** Tooltip data. */
  tooltip: TrendTooltip | null;
  /** Whether we have enough data to classify. */
  hasData: boolean;
}

const DEFAULT_THRESHOLD_PCT = 2;

/**
 * Classify a metric trend using a configurable threshold band.
 *
 * Uses the prior-period value (left-hand side) as the anchor.
 * If the anchor is zero or both sides are zero, we cannot compute a meaningful trend.
 *
 * @param current - Current period value
 * @param prior - Prior period value (anchor)
 * @param polarity - How polarity should color/give semantic meaning (null = neutral)
 * @param thresholdPct - Optional percentage threshold; defaults to ±2%.
 * @returns Classification details.
 */
export function classifyTrend(
  current: number,
  prior: number,
  polarity: MetricPolarity,
  thresholdPct: number = DEFAULT_THRESHOLD_PCT,
): TrendClassification {
  if (prior === 0) {
    return {
      direction: 'flat',
      state: 'stable',
      tooltip: { priorValue: String(prior), currentValue: String(current), delta: current - prior, pct: 0, windowLabel: 'vs. previous period' },
      hasData: false,
    };
  }
  if (current === 0) {
    return {
      direction: prior > 0 ? 'down' : 'up',
      state: 'stable',
      tooltip: { priorValue: String(prior), currentValue: String(current), delta: current - prior, pct: 0, windowLabel: 'vs. previous period' },
      hasData: false,
    };
  }

  const pctChange = ((current - prior) / Math.abs(prior)) * 100;
  const clippedPct = Math.round(pctChange * 10) / 10; // one decimal place
  const absChange = Math.round((current - prior) * 10) / 10; // handle .5 precision

  // Determine abstract direction and whether it exceeds the threshold.
  const absPct = Math.abs(clippedPct);
  let direction: TrendDirection;
  let exceedsThreshold = false;

  if (clippedPct >= 0) {
    direction = 'up';
    exceedsThreshold = clippedPct >= thresholdPct;
  } else {
    direction = 'down';
    exceedsThreshold = -clippedPct >= thresholdPct;
  }

  // Then polarize: color and meaning should respect the metric's polarity.
  let state: TrendState;
  if (direction === 'flat' || polarity === null) {
    state = 'stable';
  } else if (direction === 'up') {
    // Rising when (higher-is-better means: up is ↑, lower-is-better means: up is ↓ red)
    state = polarity === 'higher-is-better' ? 'improving' : 'declining';
  } else {
    // Falling when (higher-is-better means: down is ↓, lower-is-better means: down is ↑ green)
    state = polarity === 'higher-is-better' ? 'declining' : 'improving';
  }

  return {
    direction,
    state,
    tooltip: {
      priorValue: String(prior),
      currentValue: String(current),
      delta: absChange,
      pct: clippedPct,
      windowLabel: 'vs. previous period',
    },
    hasData: true,
  };
}