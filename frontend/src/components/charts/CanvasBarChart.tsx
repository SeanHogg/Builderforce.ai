'use client';

import type { CSSProperties } from 'react';
import { colorAt } from './chartColors';

/**
 * Reusable horizontal bar chart — the project's category-ranking primitive.
 * Renders each category as a bar with a label, primary value, and optional comparison track.
 * No external charting library — matches the hand-rolled SVG/Canvas convention.
 */

export interface BarDatum {
  /** Stable key (also the row key). */
  key: string;
  label: string;
  value: number;
  /** Optional comparison value drawn as a faint full-width track (e.g. total). */
  secondary?: number;
  /** Per-bar colour override; defaults to the palette by index. */
  color?: string;
}

export interface CanvasBarChartProps {
  data: BarDatum[];
  /** Format the value shown at the bar end (defaults to a localized rounded int). */
  formatValue?: (v: number) => string;
  /** Use one colour for every bar instead of cycling the palette. */
  monochrome?: boolean;
  /** Max bars to render; the rest collapse into a muted "+N more" footer. */
  maxRows?: number;
  /** Width in px reserved for the category labels. */
  labelWidth?: number;
  /** Unit label at the end of the bars. */
  yAxisExtraLabel?: string;
  /** Caption appended to each value (e.g. " items"). */
  tooltipSuffix?: string;
  /** Accessible description of the chart. */
  ariaLabel?: string;
}

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' };

export function CanvasBarChart({
  data,
  formatValue = (v) => Math.round(v).toLocaleString(),
  monochrome = false,
  maxRows = 6,
  labelWidth = 100,
  yAxisExtraLabel,
  tooltipSuffix,
  ariaLabel,
}: CanvasBarChartProps) {
  const rows = data.slice(0, maxRows);
  const hidden = Math.max(0, data.length - maxRows);
  // Scale against the largest of primary/secondary so a comparison track never clips
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0)));

  return (
    <div role="img" aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((d, i) => {
        const color = d.color ?? (monochrome ? colorAt(0) : colorAt(i));
        const pct = (d.value / max) * 100;
        const secPct = d.secondary != null ? (d.secondary / max) * 100 : 0;
        const suffix = tooltipSuffix ? ' ' + tooltipSuffix : '';

        return (
          <div key={d.key} style={rowStyle}>
            <span
              style={{
                width: labelWidth,
                flexShrink: 0,
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={d.label}
            >
              {d.label}
            </span>
            <div style={{ position: 'relative', flex: 1, height: 18, minWidth: 40 }}>
              {d.secondary != null && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${secPct}%`,
                    background: 'var(--border-subtle)',
                    borderRadius: 5,
                  }}
                />
              )}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${pct}%`,
                  background: color,
                  borderRadius: 5,
                  minWidth: 2,
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <span style={{ width: 64, flexShrink: 0, textAlign: 'right', fontWeight: 700 }}>
              {formatValue(d.value)}{suffix}
            </span>
          </div>
        );
      })}
      {hidden > 0 && (
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingLeft: labelWidth + 10 }}>
          +{hidden} more
        </span>
      )}
    </div>
  );
}