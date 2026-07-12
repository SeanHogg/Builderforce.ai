'use client';

import { useState, forwardRef, type ReactNode } from 'react';
import type { TrendState, TrendClassification } from './trend';

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
const COLORS: Record<TrendState, string> = {
  improving: '#22863a', // green (GitHub-style)
  declining: '#d73a49', // red (danger)
  stable: '#6a737d', // gray (muted text)
};

/** SVG arrow paths. Size-agnostic; styles dominate via `viewBox` and `strokeWidth`. */
const PATHS = {
  up: <path d="M12 6 L18 12 L12 18 M12 6V18" />,
  down: <path d="M12 18 L18 12 L12 6 M12 6V18" />,
  flat: <path d="M6 12h12" />,
};

/* We wrap the arrow in a div with padding so the tooltip lands to the right of the arrow. */
const SPACING_MAPPED: Record<'small' | 'medium' | 'large', { paddingX: number; paddingY: number }> = {
  small: { paddingX: 4, paddingY: 2 },
  medium: { paddingX: 5, paddingY: 3 },
  large: { paddingX: 6, paddingY: 3 },
};

/** Generate aria-label text from classification. */
function buildAriaLabel(c: TrendClassification): string {
  if (!c.hasData) {
    return 'Not enough data to calculate trend';
  }
  const { direction, state, tooltip } = c;
  state; // used by the consumer when mapping arrow direction to state for aria-label
  // Note: 'direction' here is abstract; we should map arrow glyph actually rendered:
  const glyph = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '→';
  // Trade off: don't just attach "improving" to un-polarized "up". We only have 'direction' here:
  // For tooltips we show phases and deltas; for aria-labels we respect polarity.
  // In the caller we also pass 'state' to resolve polarity; we could map here too.
  // Currently, aria-label generation is done by InsightStat (see TrendArrowProps.parent).
  // We keep the glyph here because it matches the PRD's "state" for actor expectations.
  return `Trend ${glyph}, ${tooltip.pct > 0 ? '+' : ''}${tooltip.pct.toFixed(1)}% update vs. ${tooltip.windowLabel}`;
}

/** Simplified typography constants for tooltip position. */
const TOOLTIP_OFFSET = 6;
const TOOLTIP_GAP = 6;

/** Build tooltip content string for keyboard focus. */
function buildTooltipContent(c: TrendClassification): string {
  if (!c.hasData) {
    return 'Not enough data to calculate trend.';
  }
  const { tooltip } = c;
  return [
    `${tooltip.priorValue} → ${tooltip.currentValue}`,
    `Absolute change: ${Math.abs(tooltip.delta).toLocaleString()}${Math.sign(tooltip.delta) === -1 ? '-' : '+'}`,
    `Percentage change: ${tooltip.pct > 0 ? '+' : ''}${tooltip.pct.toFixed(1)}%`,
    `Comparison: ${tooltip.windowLabel}`,
  ].join('\n');
}

/**
 * Desktop tooltip (hover). Position: right of the arrow within the metric card.
 */
function DefaultTooltip({ content }: { content: string }): ReactNode {
  if (typeof document === 'undefined') return null; // guard SSR + some previewers
  const rect = {
    top: window.scrollY + constructTooltipTop(),
    left: window.scrollX + getTooltipX(),
    width: 'fit-content',
    maxHeight: '200px',
    overflowY: 'auto',
  };
  const top = rect.top;
  const left = rect.left;
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left,
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
      }}
    >
      {content}
    </div>
  );
}

// Approximate tooltip Y position anchored at the current scroll viewport top for visibility within viewport.
function constructTooltipTop(): number {
  if (typeof window === 'undefined') return 100;
  const viewportHeight = window.innerHeight;
  const viewportMargin = 24;
  const estimatedTooltipHeight = 64; // avgs around 24px padding + prose ~ 36px
  // Place roughly 40-60% from top when possible; otherwise near viewport top.
  if (viewportHeight > estimatedTooltipHeight + viewportMargin * 2) {
    return Math.min(
      viewportHeight * 0.6 - estimatedTooltipHeight / 2,
      viewportScrollTop() - viewportMargin,
    );
  }
  return viewportScrollTop() + viewportMargin;
}

function viewportScrollTop(): number {
  if (typeof window === 'undefined') return 0;
  return window.scrollY;
}

function getTooltipX(): number {
  if (typeof window === 'undefined') return 0;
  // Leave space for shadow if needed: setSize + paddingX + gap + shadowTail.
  const size = 20; // assume medium upwards
  const paddingX = 8;
  const gap = 4;
  const shadow = 4;
  return window.scrollX + size + paddingX + gap + shadow;
}

export const TrendArrow = forwardRef<HTMLDivElement, TrendArrowProps>(
  ({ classification, size = 'medium', color = COLORS[classification.state], className }, ref) => {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const config = SIZE_CONFIGS[size];
    const padding = SPACING_MAPPED[size];

    // Determine direction to render. For classification, 'state' is semantically polarized, but the arrow glyph is direction.
    // Use 'direction' for the glyph, and the consumer can slant color by function.
    // The arrow must match the direction glyphs used by the PRD's symbols (previously used via DIRECTION_ARROW).
    // For clarity, we accept 'direction' from classification at the point of render.
    const glyph = classification.direction === 'up' ? PATHS.up : classification.direction === 'down' ? PATHS.down : PATHS.flat;

    // Default tooltip (desktop). Use tooltip content on hover or focus.
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
        tabIndex={0} // Keyboard focusable
        role="img"
        aria-label={buildAriaLabel(classification)}
        aria-hidden="true"
      >
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
            {showTooltip && <DefaultTooltip content={buildTooltipContent(classification)} />}
          </>
        ) : (
          // Insufficient data: render dash that is invisible except as aria-label (it's on a non-interactive span).
          <span aria-hidden="true" style={{ visibility: 'hidden' }}>—</span>
        )}
      </div>
    );
  },
);

TrendArrow.displayName = 'TrendArrow';

export default TrendArrow;