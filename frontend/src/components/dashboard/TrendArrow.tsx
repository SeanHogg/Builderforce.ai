'use client';

import { useState, forwardRef, type ReactNode } from 'react';
import { CSSProperties } from 'react';
import { TrendArrowProps, TrendClassification, COLORS } from './trend';

/**
 * Inline trend arrow component — renders an SVG arrow with tooltip, colors, and accessibility.
 * Used in metric cards and table cells to instantly communicate directional momentum.
 *
 * Colors follow the PRD (task #307):
 * - Improving: green (#22863a)
 * - Declining: red (#d73a49)
 * - Stable: gray (#6a737d)
 * - No data: dash (—), rendered visibly (FR-6).
 */

/** Size variant — scales the SVG stroke width and height. */
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

/** Arrow SVG paths — size-agnostic; styles dominate via viewBox and strokeWidth. */
const PATHS = {
  up: <path d="M12 6 L18 12 L12 18 M12 6V18" />,
  down: <path d="M12 18 L18 12 L12 6 M12 6V18" />,
  flat: <path d="M6 12h12" />,
};

/** Spacing around the arrow so the tooltip can land to the right of the arrow. */
const SPACING_MAPPED: Record<'small' | 'medium' | 'large', { paddingX: number; paddingY: number }> = {
  small: { paddingX: 4, paddingY: 2 },
  medium: { paddingX: 5, paddingY: 3 },
  large: { paddingX: 6, paddingY: 3 },
};

/** Build aria-label following the PRD format ("improving/declining/stable, up/down/→ N% vs. previous period"). */
function buildAriaLabel(
  roleId: TrendArrowProps['classification']['state'],
  direction: TrendArrowProps['classification']['direction'],
  tooltip: TrendArrowProps['classification']['tooltip'],
): string {
  if (!tooltip) {
    return 'Not enough data to calculate trend';
  }
  const dirGlyph = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '→';
  return `Trend ${dirGlyph}, ${roleId}, ${tooltip.pct > 0 ? '+' : ''}${tooltip.pct.toFixed(1)}% change vs. ${tooltip.windowLabel}`;
}

/** Build tooltip content string for keyboard focus (matches hover behavior). */
function buildTooltipContent(
  tooltip: TrendArrowProps['classification']['tooltip'],
): string {
  if (!tooltip) {
    return 'Not enough data to calculate trend.';
  }
  return [
    `${tooltip.priorValue} → ${tooltip.currentValue}`,
    `Absolute change: ${Math.abs(tooltip.delta).toLocaleString()}${
      tooltip.delta < 0 ? '-' : '+'
    }`,
    `Percentage change: ${tooltip.pct > 0 ? '+' : ''}${tooltip.pct.toFixed(1)}%`,
    `Comparison: ${tooltip.windowLabel}`,
  ].join('\n');
}

/**
 * Tooltip element — positioned absolute above/below the arrow based on height and edge of the parent.
 * Simplified from a fully adaptive position; the current offset-driven fixed placement fits the dashboard layout.
 */
function Tooltip({ content, style }: { content: string; style?: CSSProperties }): ReactNode {
  // Avoid rendering any nodes during SSR/before the DOM is fully attached.
  if (typeof document === 'undefined') return null;
  const container = document.body;
  if (!container) return null;
  // We fall back to a fixed placement relative to this wrapper via the style prop.
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

    // Determine glyph to render based on direction, independent of state.
    const glyph = classification.direction === 'up' ? PATHS.up : classification.direction === 'down' ? PATHS.down : PATHS.flat;

    // Show tooltip on hover or focus.
    const showTooltip = hovered || focused;

    // Explicit visibility for insufficient-data dash (FR-6).
    const isNoData = !classification.hasData;

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
          minWidth: 0,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        tabIndex={0}
        role="img"
        aria-label={buildAriaLabel(classification.state, classification.direction, classification.tooltip)}
        aria-hidden={isNoData ? 'true' : 'false'}
      >
        {/* CSS-positioned tooltip sibling — rendered absolutely positioned here. */}
        {showTooltip && (
          <Tooltip
            content={buildTooltipContent(classification.tooltip ?? { priorValue: '', currentValue: '', delta: 0, pct: 0, windowLabel: '' })}
            style={{
              left: `${config.width + padding.paddingX + padding.paddingX}px`,
            }}
          />
        )}

        {isNoData ? (
          // Insufficient data — render visible dash (FR-6).
          <span aria-hidden="true" style={{ fontSize: `${config.fontSize}px`, visibility: 'visible' }}>
            —
          </span>
        ) : (
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
                fontSize: `${config.fontSize}px`, // Fallback consistency
              }}
              role="presentation"
            >
              {glyph}
            </svg>
          </>
        )}
      </div>
    );
  },
);

TrendArrow.displayName = 'TrendArrow';