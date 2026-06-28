'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { colorAt } from './chartColors';

/**
 * Reusable multi-series line/area trend chart — the project's time-series
 * primitive (no charting lib; hand-rolled SVG like DonutChart). Renders one
 * smooth-ish polyline per series over a shared x index, with a y grid, end-dot
 * markers, and a legend. Responsive via ResizeObserver so it fills its card
 * without a fixed width. Drives "usage over time" / "cost over time" style
 * trends across the AI-impact and consumption surfaces.
 */

export interface TrendSeries {
  key: string;
  label: string;
  /** One value per x tick (must align with `labels`). */
  values: number[];
  color?: string;
}

export interface TrendChartProps {
  /** X-axis tick labels (e.g. week starts); length defines the point count. */
  labels: string[];
  series: TrendSeries[];
  height?: number;
  /** Format a y value for the axis + tooltips (defaults to compact int). */
  formatValue?: (v: number) => string;
  /** Fill the area under a single-series chart (ignored for multi-series). */
  area?: boolean;
  ariaLabel?: string;
}

const M = { top: 12, right: 16, bottom: 26, left: 48 };

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

export function TrendChart({
  labels,
  series,
  height = 200,
  formatValue = compact,
  area = false,
  ariaLabel,
}: TrendChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = labels.length;
  const innerW = Math.max(width - M.left - M.right, 10);
  const innerH = Math.max(height - M.top - M.bottom, 10);

  const max = useMemo(() => {
    const m = Math.max(0, ...series.flatMap((s) => s.values));
    return m <= 0 ? 1 : m;
  }, [series]);

  // Nice-ish 4-step y ticks from 0..max.
  const yTicks = useMemo(() => Array.from({ length: 5 }, (_, i) => (max / 4) * i), [max]);

  const x = (i: number) => (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => innerH - (v / max) * innerH;

  // Show at most ~6 x labels so they don't collide.
  const labelStep = Math.max(1, Math.ceil(n / 6));

  const legendStyle: CSSProperties = {
    display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: '0.8rem',
  };

  if (n === 0 || series.length === 0) return null;

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <g transform={`translate(${M.left},${M.top})`}>
          {/* y grid + labels */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" strokeWidth={1} />
              <text x={-8} y={y(t) + 4} fontSize={10} textAnchor="end" fill="var(--text-muted)">
                {formatValue(t)}
              </text>
            </g>
          ))}

          {/* x labels */}
          {labels.map((lab, i) =>
            i % labelStep === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={innerH + 16} fontSize={10} textAnchor="middle" fill="var(--text-muted)">
                {lab}
              </text>
            ) : null,
          )}

          {/* series */}
          {series.map((s, si) => {
            const color = s.color ?? colorAt(si);
            const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
            const areaPath =
              area && series.length === 1
                ? `M ${x(0)},${innerH} L ${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' L ')} L ${x(n - 1)},${innerH} Z`
                : null;
            return (
              <g key={s.key}>
                {areaPath && <path d={areaPath} fill={color} opacity={0.12} />}
                <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, i) => (
                  <circle key={i} cx={x(i)} cy={y(v)} r={i === n - 1 ? 3.5 : 2} fill={color}>
                    <title>{`${s.label} · ${labels[i]}: ${formatValue(v)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </g>
      </svg>

      {series.length > 1 && (
        <div style={legendStyle}>
          {series.map((s, si) => (
            <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color ?? colorAt(si) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
