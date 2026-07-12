/**
 * Red Alert Threshold System Utilities
 * 
 * Categorizes metric values into severity tiers:
 * - Critical (RED): 0-49 (inclusive)
 * - No Data: null, undefined, NaN, or non-numeric values
 * - Other values: handled by separate tier logic (Yellow/Green)
 */

import { RED_THEME, ThemeVariant } from '../styles/color-tokens';

export type MetricSeverity = 'critical' | 'No Data' | 'normal';

interface ThresholdConfig {
  /** Upper Red threshold (default: 49) */
  redUpperThreshold: number;
  /** Minimum positive value to treat as data (default: 0) */
  dataFloor?: number;
  /** Whether to allow negative values */
  allowNegative?: boolean;
  /** Human-readable label for Critical tier */
  criticalLabel?: string;
}

const DEFAULT_THRESHOLD: ThresholdConfig = {
  redUpperThreshold: 49,
  dataFloor: 0,
  allowNegative: false,
  criticalLabel: 'Critical',
};

export interface MetricResult {
  /** The original numeric value (if valid) */
  value: number | null;
  /** Severity classification */
  severity: MetricSeverity;
  /** Whether the value is in the Red tier */
  isRed: boolean;
  /** Whether this is "No Data" */
  isNoData: boolean;
  /** Human-readable severity label */
  label: string;
  /** Theme-safe color for rendering */
  color: string;
  /** Icon to use for this severity */
  icon: 'critical' | 'warning' | 'data';
}

/**
 * Classify a metric value into severity tiers
 */
export function classifyMetric(
  value: unknown,
  config: Partial<ThresholdConfig> = {}
): MetricResult {
  const threshold = { ...DEFAULT_THRESHOLD, ...config };
  
  // Check for null/undefined/empty
  if (value === null || value === undefined || value === '') {
    return {
      value: null,
      severity: 'No Data',
      isRed: false,
      isNoData: true,
      label: threshold.criticalLabel || 'No Data',
      color: '#9AA0A6', // Neutral gray for No Data
      icon: 'data',
    };
  }
  
  // Check for non-numeric types
  if (typeof value !== 'number' || isNaN(value)) {
    return {
      value: null,
      severity: 'No Data',
      isRed: false,
      isNoData: true,
      label: threshold.criticalLabel || 'No Data',
      color: '#9AA0A6',
      icon: 'data',
    };
  }
  
  // Check for negative values (if not allowed)
  if (!threshold.allowNegative && value < 0) {
    return {
      value: null,
      severity: 'No Data',
      isRed: false,
      isNoData: true,
      label: threshold.criticalLabel || 'No Data',
      color: '#9AA0A6',
      icon: 'data',
    };
  }
  
  // Classify based on Red threshold
  const isRed = value >= 0 && value <= threshold.redUpperThreshold;
  
  return {
    value,
    severity: isRed ? 'critical' : 'normal',
    isRed,
    isNoData: false,
    label: isRed ? threshold.criticalLabel : threshold.criticalLabel,
    color: isRed ? RED_THEME.colorCritical : '#4CAF50', // Green for normal (future tiers)
    icon: isRed ? 'critical' : 'warning',
  };
}

/**
 * Get default threshold configuration for a metric type
 * Override this per endpoint/type in your app
 */
export function getDefaultThresholdForMetricType(
  metricType: string
): ThresholdConfig {
  // Per-endpoint customization - add more as needed
  const customThresholds: Record<string, ThresholdConfig> = {
    'quality-score': {
      redUpperThreshold: 49,
      dataFloor: 0,
      allowNegative: false,
      criticalLabel: 'Critical',
    },
    'Bug Rate': {
      redUpperThreshold: 4.9, // Example: 4.9 bugs per 1k
      dataFloor: 0,
      allowNegative: false,
      criticalLabel: 'Critical',
    },
    'Coverage': {
      redUpperThreshold: 49, // 49% coverage
      dataFloor: 0,
      allowNegative: false,
      criticalLabel: 'Critical',
    },
  };
  
  return customThresholds[metricType] || { ...DEFAULT_THRESHOLD };
}

/**
 * Validate threshold configuration
 */
export function validateThresholdConfig(
  threshold: Partial<ThresholdConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check numeric threshold bounds
  if (threshold.redUpperThreshold !== undefined) {
    if (typeof threshold.redUpperThreshold !== 'number' || isNaN(threshold.redUpperThreshold)) {
      errors.push('redUpperThreshold must be a number');
    } else if (threshold.redUpperThreshold < 1 || threshold.redUpperThreshold > 99) {
      errors.push('redUpperThreshold must be between 1 and 99');
    }
  }
  
  if (threshold.dataFloor !== undefined) {
    if (typeof threshold.dataFloor !== 'number' || isNaN(threshold.dataFloor)) {
      errors.push('dataFloor must be a number');
    } else if (threshold.dataFloor < 0) {
      errors.push('dataFloor cannot be negative');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// Re-export types and constants for component use
export type { MetricSeverity, ThresholdConfig, MetricResult };