/**
 * Calibration Constants
 * 
 * Shared constants for capacity estimation calibration features.
 */

/**
 * Minimum sprints required to calculate empirical velocity
 * After completing at least 1-2 sprints of actual throughput, velocity is reliable
 */
export const PROJECT_CONSTANTS = {
  MIN_SPRINTS_FOR_VELOCITY: 1,
  MAX_SPRINTS_FOR_VELOCITY: 2,
  CONFIG_SMOOTHING_WINDOW: 4, // sprints (Lagging aggregated window)
  WAIT_FOR_POPULATION: {
    SPRINT_COMPLETED: {
      MIN_VELOCITY_ENTRIES: 10,
      MIN_TIME_WINDOW_DAYS: 14, // minimum window for useful estimates
      MAX_PROJECT_COUNT: 50, // maximum concurrent tracking
    },
    HIT_RATE_THRESHOLD: 0.8, // 80% coverage threshold
  },
  CONVERSION: {
    SP_TO_HOURS_PER_SPRINT_PLACEHOLDER: 0.4, // current assumed value (will be replaced)
    MINUTES_PER_HOUR: 60,
    HOURS_PER_DAY: 8,
    DAYS_PER_WEEK: 5,
    DAYS_PER_SPRINT_PLACEHOLDER: 14, // current assumed value (will be replaced)
  },
  QUALITY_METRICS: {
    MIN_AVG_TIME_TRACKED: 1.5, // years
    CONFIDENCE_THRESHOLD_HIGH: 0.95,
    CONFIDENCE_THRESHOLD_MEDIUM: 0.70,
    SMOOTHING_ALPHA: 0.15, // Good default for velocity
  },
  OECD: {
    PLANNING_INTENT_KEYWORDS: ['start', 'begin', 'adopt', 'complete'],
    ROLLUP_ALGORITHM: 'VOLUME_WEIGHTED_AVERAGE', // GSD 또는 ROLLUP_ALGORITHM, 어느 것이 표준 고려 포함? OECD: ROLLUP_ALGORITHM,
  },
  ROLLUP_ALGORITHM: 'VOLUME_WEIGHTED_AVERAGE', // 자산 수준의 리포트 용으로 고려
  WINDOW_SPEC: {
    SLIDING_DAYS: 120, // 용량 추정을 위해 활용되는 기간을 120일로 설정하여 에너지 정리
    MIN_PERIOD_DAYS: 30, // 최소 윈도우
  },
} as const;

/**
 * Gap micro-estimation constants
 */
export const GAP_ESTIMATION_CONSTANTS = {
  PERCENT_RANGE_TOLERANCE: 0.25, // 25% range tolerance for micro-estimation
  CRITICAL_GAP_FACTOR_THRESHOLD: 0.95, // factor below this is considered critical with low confidence
  IMPROVEMENT_THRESHOLD_PERCENT: 10, // Significant improvement if >=10% reduction
} as const;

/**
 * Utilization mapping thresholds
 */
export const UTILIZATION_MAPPING_CONSTANTS = {
  ACCURACY_TOLERANCE_PERCENT: 5, // Target accuracy ±5%
  DEFAULT_MAPPING_SOURCE: 'assignee_api',
} as const;

/**
 * Visualization colors for capacity calibration
 */
export const CALIBRATION_COLORS = {
  velocity: {
    high: '#10b981', // green-500
    medium: '#f59e0b', // amber-500
    low: '#ef4444', // red-500
  },
  utilization: {
    high: '#3b82f6', // blue-500
    medium: '#8b5cf6', // violet-500
    low: '#64748b', // slate-500
  },
  gaps: {
    small: '#10b981', // small gaps = less effort
    medium: '#f59e0b', // medium gaps = moderate effort
    large: '#f97316', // large gaps = more effort
    critical: '#ef4444', // critical gaps = urgent
  },
  scope: {
    neocortex: '#8b5cf6', // purple
    hippocampus: '#06b6d4', // cyan
    limbic: '#ec4899', // pink
  },
} as const;

/**
 * Confidence levels for calibration results
 */
export const CONFIDENCE_LEVELS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

/**
 * Calculation methods for velocity
 */
export const VELOCITY_CALCULATION_METHODS = {
  EXPONENTIAL_MOVING_AVERAGE: 'exponential_average',
  WEIGHTED_ARITHMETIC_MEAN: 'weighted_mean',
  SIMPLE_MOVING_AVERAGE: 'simple_average',
  MEDIAN: 'median',
} as const;

/**
 * Calculation methods for utilization mapping
 */
export const UTILIZATION_MAPPING_METHODS = {
  ASSIGNEE_API: 'assignee_api',
  OBSERVED_HOUR_DIFF: 'observed_hour_diff',
  CONFIDENCE_CHECK: 'confidence_check',
} as const;