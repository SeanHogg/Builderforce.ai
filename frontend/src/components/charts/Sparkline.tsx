'use client';

import { colorAt } from './chartColors';

/**
 * Tiny inline sparkline — a single-series trend with no axes, sized to sit
 * inside a StatCard, table cell, or dashboard tile. Hand-rolled SVG (matches the
 * DonutChart convention) so it carries no layout cost and no charting dep.
 */

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Fill the area under the line (default true). */
  area?: boolean;
  ariaLabel?: string;
}

export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = colorAt(0),
  area = true,
  ariaLabel,
}: SparklineProps) {
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const n = values.length;
  const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (v: number) => height - ((v - min) / span) * height;

  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const areaPath = `M ${x(0)},${height} L ${values.map((v, i) => `${x(i)},${y(v)}`).join(' L ')} L ${x(n - 1)},${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
      {area && <path d={areaPath} fill={color} opacity={0.14} />}
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
