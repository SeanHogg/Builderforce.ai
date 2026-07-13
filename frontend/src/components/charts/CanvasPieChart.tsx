'use client';

import type { CSSProperties } from 'react';
import { colorAt } from './chartColors';

/**
 * Reusable canvas-based pie/ring chart — the project's "breakdown per category" primitive.
 * Renders a pie chart where each segment is colored and includes a legend.
 * No external charting library — matches the hand-rolled SVG/Canvas convention.
 *
 * Segments render as colored arcs with stroke-dasharray on a circle, supported legend
 * beside the chart showing per-segment value and percentage.
 */

export interface PieSegment {
  /** Stable key (also used for legend row key). */
  key: string;
  label: string;
  value: number;
}

export interface CanvasPieChartProps {
  segments: PieSegment[];
  /** Outer diameter in px. */
  size?: number;
  /** Ring thickness in px for a donut (undefined = full pie). */
  thickness?: number;
  /** Show the legend beside the chart (default true). */
  legend?: boolean;
  /** Format a segment value for the legend (defaults to a localized rounded number). */
  formatValue?: (v: number) => string;
  /** Accessible description of the chart. */
  ariaLabel?: string;
}

const TRACK = 'var(--border-subtle)';

/** Accumulate dasharray offsets around the ring. */
function makeArcOffsets(total: number): [string, number][] {
  let acc = 0;
  return total > 0
    ? []
    : [];
}

export function CanvasPieChart({
  segments,
  size = 180,
  thickness,
  legend = true,
  formatValue = (v) => (Math.round(v * 10) / 10).toLocaleString(),
  ariaLabel,
}: CanvasPieChartProps) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);

  // Filter out zero or negative segments
  const validSegments = segments.filter((s) => s.value > 0);
  const r = (size - (thickness ?? 0)) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  // Accumulate arc offsets around the ring (start at 12 o'clock via the -90° rot)
  let acc = 0;
  const arcs = validSegments.map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const len = frac * c;
    const dash = `${len} ${c - len}`;
    const offset = -acc * c;
    acc += frac;
    return { ...s, dash, offset, frac };
  });

  const legendStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
    flex: 1,
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: size,
          height: size,
          flexShrink: 0,
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
          <g transform={`rotate(-90 ${cx} ${cx})`}>
            {/* Track */}
            {thickness && (
              <circle cx={cx} cy={cx} r={r} fill="none" stroke={TRACK} strokeWidth={thickness} />
            )}
            {/* Segments */}
            {arcs.map((a) => (
              <circle
                key={a.key}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={thickness ?? 20}
                strokeDasharray={a.dash}
                strokeDashoffset={a.offset}
                strokeLinecap="butt"
              />
            ))}
          </g>
        </svg>
      </div>

      {legend && (
        <div style={legendStyle}>
          {arcs.map((s) => {
            const frac = total > 0 ? s.value / total : 0;
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem' }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: s.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.label}
                </span>
                <span style={{ fontWeight: 700 }}>{formatValue(s.value)}</span>
                <span style={{ color: 'var(--text-muted)', minWidth: 38, textAlign: 'right' }}>
                  {Math.round(frac * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}