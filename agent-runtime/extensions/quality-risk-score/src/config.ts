/**
 * Configuration types for the Quality Risk Score extension.
 *
 * A quality metric contributes to an artifact's overall risk. Some metrics are
 * "higher is worse" (e.g. open bugs, deployment failures) and some are
 * "higher is better" (e.g. test coverage, performance score). The `direction`
 * field disambiguates so the scoring engine can normalise every metric onto a
 * common 0..1 risk scale where 1 = maximum risk.
 */

export type MetricDirection = 'higher_is_worse' | 'higher_is_better';

export interface QualityMetric {
  /** Stable identifier / display label for the metric. */
  name: string;
  /** Current observed value of the metric. */
  value: number;
  /** Relative importance of this metric in the aggregate (must be > 0). */
  weight: number;
  /**
   * Whether a larger `value` means more risk (default) or less risk.
   * Defaults to `higher_is_worse` when omitted.
   */
  direction?: MetricDirection;
  /**
   * Threshold values used to normalise and explain the metric. `low` and
   * `high` bound the normalisation range; `medium` is informational.
   */
  threshold: {
    low: number;
    medium: number;
    high: number;
  };
}

export interface RiskScoreConfig {
  metrics: QualityMetric[];
  overrideAllowed: boolean;
  /** Minimum number of minutes between automatic re-evaluations. */
  reevaluationInterval: number;
}

export interface Artifact {
  id?: string;
  type: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_CONFIG: RiskScoreConfig = {
  metrics: [],
  overrideAllowed: true,
  reevaluationInterval: 5,
};
