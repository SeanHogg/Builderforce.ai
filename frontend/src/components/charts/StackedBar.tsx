'use client';

import type { CSSProperties } from 'react';

/**
 * Reusable 100%-stacked horizontal bar — the project's PART-TO-WHOLE primitive
 * (no charting lib; matches the hand-rolled DonutChart / BarChart / BandedMetricBar
 * convention). Where DonutChart answers "what is the mix" for one whole and
 * BarChart ranks magnitudes, this answers "how does ONE whole split between a few
 * named parts", and stacks legibly for many rows (one bar per category).
 *
 * Mark spec (deliberate, shared with the other primitives):
 *   • bar ≤ 24px thick, 4px rounded OUTER data-ends, square where segments meet;
 *   • a 2px gap in the SURFACE colour separates touching segments — the gap does
 *     the separating, never a stroke drawn around a segment;
 *   • an inline value label appears only when the segment is wide enough to hold
 *     it with padding (never clipped); otherwise the legend + the row-end value
 *     carry it;
 *   • label ink inside a fill flips white/dark by the fill's luminance, so it
 *     picks the more legible of the two on any palette entry, in either theme.
 *
 * The inline label is deliberately a REDUNDANT reinforcement, never the only
 * place a value appears: a small label on a saturated mid-tone fill sits near the
 * 4.5:1 small-text line whichever ink wins, so every caller also shows the figure
 * in ordinary text ink (the legend value, or a row-end readout) and each segment
 * carries a `title` with its label, value and share. Nothing is gated behind it.
 */

export interface StackedSegment {
  /** Stable key (also the legend row key). */
  key: string;
  label: string;
  value: number;
  /** Any CSS colour (hex, or a `var(--token)` for the de-emphasis/neutral part). */
  color: string;
  /** Force the inline label ink when `color` is not a parseable hex. */
  onFill?: 'light' | 'dark';
}

export interface StackedBarProps {
  segments: StackedSegment[];
  /** Bar thickness in px (capped at the 24px mark spec). */
  height?: number;
  /** Format a segment value for the legend (defaults to a rounded int). */
  formatValue?: (v: number) => string;
  /** Show the legend beside/below the bar. Required for ≥2 series unless the
   *  caller renders ONE shared legend above a group of bars. */
  legend?: boolean;
  /** Minimum share (0–1) a segment needs before it gets an inline % label. */
  minLabelShare?: number;
  ariaLabel?: string;
}

/** Perceived luminance of a #rgb/#rrggbb fill → which ink stays legible on it. */
function inkOn(color: string, override?: 'light' | 'dark'): string {
  if (override) return override === 'light' ? '#fff' : '#0b1220';
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return '#fff';
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  // Rec. 709 relative luminance — good enough to pick ink, cheap to compute.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#0b1220' : '#fff';
}

const legendRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' };

export function StackedBar({
  segments,
  height = 20,
  formatValue = (v) => Math.round(v).toLocaleString(),
  legend = true,
  minLabelShare = 0.16,
  ariaLabel,
}: StackedBarProps) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const drawn = segments.filter((s) => s.value > 0);
  const thickness = Math.min(24, height);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div
        role="img"
        aria-label={ariaLabel}
        style={{
          display: 'flex', gap: 2, height: thickness, borderRadius: 'var(--radius-sm)', minWidth: 0,
          // Empty state: an inert track so the row keeps its geometry.
          background: total > 0 ? 'transparent' : 'var(--border-subtle)',
        }}
      >
        {drawn.map((s, i) => {
          const frac = s.value / total;
          const first = i === 0;
          const last = i === drawn.length - 1;
          return (
            <div
              key={s.key}
              title={`${s.label}: ${formatValue(s.value)} (${Math.round(frac * 100)}%)`}
              style={{
                flex: `${frac} 0 0`, minWidth: 2, background: s.color,
                // 4px rounded OUTER ends; interior joins stay square (the gap separates).
                borderTopLeftRadius: first ? 4 : 0, borderBottomLeftRadius: first ? 4 : 0,
                borderTopRightRadius: last ? 4 : 0, borderBottomRightRadius: last ? 4 : 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'flex-grow 0.3s',
              }}
            >
              {frac >= minLabelShare && (
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: inkOn(s.color, s.onFill), whiteSpace: 'nowrap' }}>
                  {Math.round(frac * 100)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {legend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', minWidth: 0 }}>
          {segments.map((s) => (
            <span key={s.key} style={legendRow}>
              <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-sm)', background: s.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{formatValue(s.value)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The legend for a GROUP of {@link StackedBar} rows that all share the same
 * series (e.g. one bar per origin, every bar split autonomous/human). Rendered
 * once above the group so identity is never carried by colour alone, without
 * repeating a legend per row.
 */
export function StackedBarLegend({ items }: { items: Array<{ key: string; label: string; color: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', minWidth: 0 }}>
      {items.map((s) => (
        <span key={s.key} style={legendRow}>
          <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-sm)', background: s.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}
