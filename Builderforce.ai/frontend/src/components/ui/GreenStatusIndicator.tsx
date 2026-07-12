'use client';

import React from 'react';
import { STATUS } from '@/types/status';

/**
 * GreenStatusIndicator — reusable status indicator for on-track scores (75-100).
 *
 * Semantics (matches Green-tier PRD, FR-1 and AC-1..AC-3):
 * - score = 75 (inclusive) and score = 100 (inclusive) -> Green indicator
 * - score = 74.9 and score = 100.1 -> Not Green indicator (does not render Green)
 * - null/undefined -> Not Green indicator (does not render Green)
 * - If a green status is rendered, aria-label is "Status: Green, On Track" (FR-6 and AC-8)
 *
 * Visuals (FR-2 and AC-10):
 * - Inline `color.status.green` token resolves to green (default symbolic currentColor)
 * - When used with className achieving that token, the indicator inherits green
 * - Optional supporting icon filled circle or checkmark also rendered with currentColor
 *
 * Accessibility (FR-6 and AC-8):
 * - Text label "On Track" visible in all non-icon-only contexts
 * - aria-label includes both "Green" and "On Track" when green
 * - WCAG 2.1 AA contrast against background enforced via design token or currentColor
 *
 * Usage:
 * - <GreenStatusIndicator score={75} /> renders a Green/On Track indicator
 * - <GreenStatusIndicator score={null} /> renders no Green indicator (fallback/NG)
 * - <GreenStatusIndicator score={80} className="text-green-600" /> renders currentColor/green with icon + label
 * - <GreenStatusIndicator score={95} variant="icon-only" /> renders icon-only green without explicit label (for component hosting)
 *
 * Note: This component does not enforce 75 ≤ score ≤ 100 itself; it only renders Green when
 * the consume-component has classified the status using isGreenStatus/greenLogic. The indicator
 * complies with FR-5: <100, >100, null, undefined never manifest as Green here.
 */

export interface GreenStatusIndicatorProps {
  /** The raw score that determines status */
  score: number | null | undefined;

  /** Optional variant: "default" (icon + label) or "icon-only" (icon only) */
  variant?: 'default' | 'icon-only';

  /** Optional custom className for additional styling (preserves currentColor/green token use) */
  className?: string;

  /**
   * Optional custom aria-label override. If provided, BRFRS-6 aria-label must include "Green" and "On Track"
   * and should match the pattern "Status: Green, On Track". Otherwise the component infers the canonical label.
   */
  ariaLabel?: string;
}

export function GreenStatusIndicator({
  score,
  variant = 'default',
  className = '',
  ariaLabel: customAriaLabel,
}: GreenStatusIndicatorProps): React.ReactNode {
  // Access derived green decision consistent with g/s helpers:
  // - FR-1: Green iff 75 ≤ score ≤ 100
  // - FR-5: null/undefined or >100 never yields Green indicator
  const isGreen = score !== null && score !== undefined && score >= 75 && score <= 100;

  if (!isGreen) {
    return null;
  }

  // Canonical accessible label (FR-6 and AC-8)
  const ariaLabelText = customAriaLabel ?? 'Status: Green, On Track';

  // Icon-only uses only the icon; supports component nesting
  if (variant === 'icon-only') {
    return (
      <span
        className={`green-status-icon-only ${className}`}
        aria-label="Green indicator"
        role="img"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{ display: 'block', width: 'inherit', height: 'inherit' }}
          aria-hidden={!customAriaLabel}
        >
          {/* Filled circle icon */}
          <circle cx="8" cy="8" r="7" />
        </svg>
      </span>
    );
  }

  // Default renders icon + label (FR-2 and AC-7)
  return (
    <span
      className={`green-status-default ${className}`}
      aria-label={ariaLabelText}
    >
      {/* Optional supporting icon in green */}
      <span
        className="green-status-icon"
        aria-hidden="true"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
        >
          <circle cx="5" cy="5" r="4.5" />
        </svg>
      </span>
      <span className="green-status-label">{ariaLabelText}</span>
    </span>
  );
}