'use client';

import React from 'react';
import { STATUS } from '@/types/status';

/** GreenStatusIndicatorProps */
export interface GreenStatusIndicatorProps {
  /** The raw score that determines status */
  score: number | null | undefined;
  /** Optional variant: 'default' (icon + full label) or 'icon-only' (icon only) */
  variant?: 'default' | 'icon-only';
  /** Optional custom className for additional styling */
  className?: string;
  /** Optional custom aria-label override. If provided, it must include "Green" and "On Track". */
  ariaLabel?: string;
}

/** Score to GreenStatusIndicator bridge helper. */
export function scoreToGreenStatus(score: number | null | undefined): GreenStatusIndicatorProps {
  const isGreen = score !== null && score !== undefined && score >= 75 && score <= 100;
  if (!isGreen) {
    return { score, variant: 'default' };
  }
  return {
    score,
    variant: 'default',
    ariaLabel: `Status: Green, On Track`,
  };
}

/** GreenStatusIndicator — canonical on-track status indicator (75 ≤ score ≤ 100). */
export function GreenStatusIndicator({
  score,
  variant = 'default',
  className = '',
  ariaLabel: customAriaLabel,
}: GreenStatusIndicatorProps): React.ReactNode {
  const isGreen = score !== null && score !== undefined && score >= 75 && score <= 100;

  if (!isGreen) {
    return null;
  }

  // Canonical accessible label (FR‑6 / AC‑8)
  // Must include both "Green" and "On Track". When overridden by ariaLabel, consumers are responsible to keep both.
  const ariaLabelText = customAriaLabel ?? 'Status: Green, On Track';

  // Icon-only variant
  if (variant === 'icon-only') {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full ${className}`}
        aria-label="Green indicator"
        role="img"
        aria-hidden={!customAriaLabel}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ display: 'block', width: 'inherit', height: 'inherit' }}>
          {/* Friendly text */}
          {customAriaLabel != null && customAriaLabel.trim().length > 0 && customAriaLabel.length < 50 && (
            <text x="8" y="11" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="600">
              ✓
            </text>
          )}
          {/* Filled circle fallback */}
          <circle cx="8" cy="8" r="7.5" />
        </svg>
      </span>
    );
  }

  // Default variant: icon + visible friendly label + full aria label (FR‑2 / AC‑7 / AC‑10)
  // Friendly label is always visible in the DOM; aria-label is for screen readers.
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 border border-green-200 ${className}`}
      aria-label={ariaLabelText}
      role="status"
    >
      {/* Optional icon */}
      <span className="relative inline-flex -ml-0.5 -mt-0.5" aria-hidden="true">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
          <circle cx="4" cy="4" r="3.5" />
        </svg>
      </span>
      {/* Visible friendly label per FR‑2 / AC‑7 (always present) */}
      <span className="text-on-track">On Track</span>
    </span>
  );
}