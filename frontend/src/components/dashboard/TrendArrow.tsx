'use client';

import { useState, forwardRef, type ReactNode } from 'react';
import { CSSProperties } from 'react';
import { TrendArrowProps, TrendClassification } from './trend';

/**
 * Inline trend arrow component — renders an SVG arrow with tooltip, colors, and accessibility.
 * Used in metric cards and table cells to instantly communicate directional momentum.
 *
 * Colors follow the PRD (task #307):
 * - Improving: green (#22863a)
 * - Declining: red (#d73a49)
 * - Stable: gray (#6a737d)
 * - No data: dash (—) embedded in the aria-label portion (title fallback).
 */

export interface TrendArrowProps {
  /** Classification result. */
  classification: TrendClassification;
  /** Size variant — scales the SVG stroke width and height. */
  size?: 'small' | 'medium' | 'large';
  /** Optional custom color override. */
  color?: string;
  /** Optional className slot. */
  className?: string;
}

const SIZE_CONFIGS: Record<'small' | 'medium' | 'large', { width: number; height: number; strokeWidth: number }> = {
  small: { width: 16, height: 16, strokeWidth: 1.2 },
  medium: { width: 20, height: 20, strokeWidth: 1.5 },
  large: { width: 24, height: 24, strokeWidth: 2 },
};

/** Colors from the PRD (task #307 — Trend Arrows PRD). */
export const COLORS = {
  improving: '#22863a', // green (GitHub-style)
  declining: '#d73a49', // red (danger)
  stable: '#6a737d', // gray (muted text)
} as const;

/** SVG arrow paths. Size-agnostic; styles dominate via `viewBox` and `strokeWidth`. */
const PATHS = {
  up: <path d="M12 6 L18 12 L12 18 M12 6V18" />,
  down: <path d="M12 18 L18 12 L12 6 M12 6V18" />,
  flat: <path d="M6 12h12" />,
};

/* We wrap the arrow in a div with padding so the tooltip can land to the right of the arrow. */
const SPACING_MAPPED: Record<'small' | 'medium' | 'large', { paddingX: number; paddingY: number }> = {
  small: { paddingX: 4, paddingY: 2 },
  medium: { paddingX: 5, paddingY: 3 },
  large: { paddingX: 6, paddingY: 3 },
};

/** Generate aria-label text from classification. */
function buildAriaLabel(
  direction: TrendArrowProps['classification']['direction'],
  tooltip: TrendArrowProps['classification']['tooltip'],
): string {
  // We don't have the polarized state here; we generate a direction- and delta-facing label that does not
  // misattribute the arrow guess to polarity. For informational tooltips (hover/focus) we show the phases.
  if (!tooltip) {
    return 'Not enough data to calculate trend';
  }
  const glyph = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '→';
  return `Trend ${glyph}, ${tooltip.pct > 0 ? '+' : ''}${tooltip.pct.toFixed(1)}% change vs. ${tooltip.windowLabel}`;
}

/** Build tooltip content string for keyboard focus. */
function buildTooltipContent(
  tooltip: TrendArrowProps['classification']['tooltip'],
): string {
  if (!tooltip) {
    return 'Not enough data to calculate trend.';
  }
  return [
    `${tooltip.priorValue} → ${tooltip.currentValue}`,
    `Absolute change: ${Math.abs(tooltip.delta).toLocaleString()}${Math.sign(tooltip.delta) === -1 ? '-' : '+'}`,
    `Percentage change: ${tooltip.pct > 0 ? '+' : ''}${tooltip.pct.toFixed(1)}%`,
    `Comparison: ${tooltip.windowLabel}`,
  ].join('\n');
}

/**
 * Tooltip element. uses sizing and styles for positioning via props.
 */
function Tooltip({ content, style }: { content: string; style?: CSSProperties; alignRight?: boolean }): ReactNode {
  if (typeof document === 'undefined') return null; // guard SSR + some previewers
  const container = document.body;
  if (!container) return null;
  // We fallback to a fixed-right positioning within the parent container using calculation passed via style.
  // This satisfies the PRD: "Hovering or focusing the arrow displays a tooltip".
  return (
    <div
      style={{
        ...style,
        position: 'absolute',
        maxWidth: 180,
        padding: 8,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        fontSize: 11,
        color: 'var(--text-primary)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        zIndex: 50,
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
        top: '50%',
        transform: 'translateY(-50%)',
      }}
    >
      {content}
    </div>
  );
}

export const TrendArrow = forwardRef<HTMLDivElement, TrendArrowProps>(
  ({ classification, size = 'medium', color = COLORS[classification.state], className }, ref) => {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const config = SIZE_CONFIGS[size];
    const padding = SPACING_MAPPED[size];

    // Determine direction to render. For classification, 'state' is semantically polarized, but arrow glyph is direction.
    const glyph = classification.direction === 'up' ? PATHS.up : classification.direction === 'down' ? PATHS.down : PATHS.flat;

    // Show tooltip on hover or focus.
    const showTooltip = hovered || focused;

    // ariaLabel is still generated by InsightStat for consistency.
    return (
      <div
        ref={ref}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          margin: 0,
          padding: `${padding.paddingY}px ${padding.paddingX}px`,
          minWidth: 0, // let the container shrink without causing overflow
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        tabIndex={0} // Keyboard focusable (FR-7, AC-8)
        role="img"
        aria-label={buildAriaLabel(classification.direction, classification.tooltip)}
        aria-hidden="true"
      >
        {/* CSS-positioned tooltip sibling — will be rendered absolutely positioned within this wrapper */}
        {showTooltip && (
          <Tooltip
            content={buildTooltipContent(classification.tooltip ?? { priorValue: '', currentValue: '', delta: 0, pct: 0, windowLabel: '' })}
            style={{
              left: `${config.width + padding.paddingX + SPACING_MAPPED['medium'].paddingX}px`, // right of the arrow with padding
            }}
          />
        )}

        {classification.hasData ? (
          <>
            <svg
              width={config.width}
              height={config.height}
              viewBox="0 0 24 24"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                width: '100%',
                height: '100%',
                color,
                transition: 'transform 0.15s ease-out',
              }}
              role="presentation"
              aria-hidden="true"
            >
              {glyph}
            </svg>
          </>
        ) : (
          // Insufficient data: render dash that is invisible except as aria-label (it's on a non-interactive span).
          <span
            aria-hidden="true"
            style={{ visibility: 'hidden' }}
            dangerouslySetInnerHTML={{ __html: '—' }}
          />
        )}
      </div>
    );
  },
);

TrendArrow.displayName = 'TrendArrow';

export default TrendArrow;