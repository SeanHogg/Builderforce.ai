/**
 * Metric Severity Badge Component
 * 
 * Renders a badge with critical severity color, icon, and label for metrics
 * in the Critical tier (0-49).
 * 
 * Usage:
 * ```tsx
 * <MetricSeverityBadge 
 *   value={metric.value} 
 *   thresholdUpper={49}
 *   showLabel
 *   showIcon
 * />
 * ```
 */

import React from 'react';
import { classifyMetric, MetricResult } from '../../utils/redAlertUtils';
import { RED_THEME } from '../../styles/color-tokens';

export interface MetricSeverityBadgeProps {
  /** The metric value to evaluate */
  value: number | null | undefined;
  /** Upper Red threshold */
  thresholdUpper: number;
  /** Show the severity label */
  showLabel?: boolean;
  /** Show the alert icon */
  showIcon?: boolean;
  /** Custom label for No Data state */
  noDataLabel?: string;
  /** Custom label for Critical state */
  criticalLabel?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Theme variant */
  theme?: 'light' | 'dark';
  /** Whether to treat negative values as data */
  allowNegative?: boolean;
  /** Manual icon override (useful for testability / iframe injection) */
  manualIcon?: 'critical' | 'warning' | 'data';
}

export const MetricSeverityBadge: React.FC<MetricSeverityBadgeProps> = ({
  value,
  thresholdUpper,
  showLabel = true,
  showIcon = true,
  noDataLabel,
  criticalLabel,
  size = 'md',
  theme = 'light',
  allowNegative = false,
  manualIcon,
}) => {
  // Classify the metric
  const result: MetricResult = classifyMetric(value, { 
    redUpperThreshold: thresholdUpper,
    allowNegative,
    criticalLabel: criticalLabel || noDataLabel || 'No Data'
  });
  
  // Size mapping
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };
  
  const iconSize = size === 'sm' ? '14px' : size === 'md' ? '16px' : '20px';
  
  // Determine icon to render (fallback to auto-detection if manual forced)
  const icon = manualIcon !== undefined ? manualIcon : result.icon;

  // Critical/No Data state rendering — a manual icon override of 'data' forces
  // the No Data presentation regardless of the classified value (used for
  // testability / iframe injection scenarios).
  if (result.isNoData || icon === 'data') {
    return (
      <span 
        className={`bg-gray-100 text-gray-500 rounded ${sizeClasses[size]}`}
        title="No data available"
      >
        {showLabel && (
          <>
            {showIcon && (
              <span className="inline-flex items-center justify-center">
                <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </span>
            )}
            <span className={`ml-1 ${showIcon ? '' : 'ml-0'}`}>{noDataLabel || 'No Data'}</span>
          </>
        )}
      </span>
    );
  }
  
  // Critical (Red) state rendering
  if (result.isRed) {
    return (
      <span 
        className={`bg-red-50 text-red-700 rounded inline-flex items-center gap-0.5 ${sizeClasses[size]}`}
        style={{ borderColor: RED_THEME.colorCritical, borderWidth: '1px' }}
        title={`${result.label}: ${value} (Threshold: ≤${thresholdUpper})`}
      >
        {showIcon && (
          <span className="inline-flex items-center justify-center text-red-600">
            <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke={RED_THEME.colorCritical} strokeWidth="2" />
              <path d="M12 16L12 12" stroke={RED_THEME.colorCritical} strokeWidth="2" strokeLinecap="round" />
              <path d="M12 8L12.01 8" stroke={RED_THEME.colorCritical} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        )}
        {showLabel && (
          <span className="font-medium text-red-700">{criticalLabel || result.label}</span>
        )}
      </span>
    );
  }
  
  // Normal state (for future tiers - Yellow/Green)
  return (
    <span 
      className={`bg-green-100 text-green-700 rounded inline-flex items-center gap-0.5 ${sizeClasses[size]}`}
    >
      {showIcon && (
        <span className="inline-flex items-center justify-center text-green-600">
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="#4CAF50" strokeWidth="2" />
            <path d="M8 12L11 15L16 9" stroke="#4CAF50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      {showLabel && (
        <span className="font-medium text-green-700">Normal</span>
      )}
    </span>
  );
};

export default MetricSeverityBadge;