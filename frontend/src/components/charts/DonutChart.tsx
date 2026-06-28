'use client';

import type { CSSProperties } from 'react';

/**
 * Reusable SVG donut/ring chart — the project's first general-purpose chart
 * primitive (no charting lib; matches the hand-rolled D3/SVG convention). Drives
 * the cost-report capitalization + investment-mix donuts and is intentionally
 * generic so any future breakdown can reuse it.
 *
 * Segments render as arcs on a single ring via stroke-dasharray; an optional
 * centre label and legend (with per-segment value + share) sit alongside.
 */

export interface DonutSegment {
  /** Stable key (also used for the legend row key). */
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  /** Outer diameter in px. */
  size?: number;
  /** Ring thickness in px. */
  thickness?: number;
  /** Big number in the centre (already formatted). */
  centerValue?: string;
  /** Small caption under the centre value. */
  centerLabel?: string;
  /** Format a segment value for the legend (defaults to a rounded number). */
  formatValue?: (v: number) => string;
  /** Show the legend beside the ring (default true). */
  legend?: boolean;
  /** Accessible description of the chart. */
  ariaLabel?: string;
}

const TRACK = 'var(--border-subtle)';

export function DonutChart({
  segments,
  size = 168,
  thickness = 26,
  centerValue,
  centerLabel,
  formatValue = (v) => (Math.round(v * 10) / 10).toLocaleString(),
  legend = true,
  ariaLabel,
}: DonutChartProps) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  // Accumulate arc offsets around the ring (start at 12 o'clock via the -90° rot).
  let acc = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = total > 0 ? s.value / total : 0;
      const len = frac * c;
      const dash = `${len} ${c - len}`;
      const offset = -acc * c;
      acc += frac;
      return { ...s, dash, offset, frac };
    });

  const legendStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
          <g transform={`rotate(-90 ${cx} ${cx})`}>
            {/* track */}
            <circle cx={cx} cy={cx} r={r} fill="none" stroke={TRACK} strokeWidth={thickness} />
            {arcs.map((a) => (
              <circle
                key={a.key}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={thickness}
                strokeDasharray={a.dash}
                strokeDashoffset={a.offset}
                strokeLinecap="butt"
              />
            ))}
          </g>
        </svg>
        {(centerValue || centerLabel) && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none',
            }}
          >
            {centerLabel && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{centerLabel}</span>}
            {centerValue && <span style={{ fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.1 }}>{centerValue}</span>}
          </div>
        )}
      </div>

      {legend && (
        <div style={legendStyle}>
          {segments.map((s) => {
            const frac = total > 0 ? s.value / total : 0;
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                <span style={{ fontWeight: 700 }}>{formatValue(s.value)}</span>
                <span style={{ color: 'var(--text-muted)', minWidth: 38, textAlign: 'right' }}>{Math.round(frac * 100)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
