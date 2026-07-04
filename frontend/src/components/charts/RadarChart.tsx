'use client';

/**
 * Reusable radar / spider chart — the diagnostic's "profile at a glance" primitive
 * (no charting lib; hand-rolled SVG like DonutChart/GaugeChart). Plots N axes on a
 * regular polygon with concentric rings; the value polygon is filled so a
 * multi-dimension maturity/score profile reads as one shape. Generic: any set of
 * {label, value} on a shared 0..max scale can reuse it.
 *
 * Presentation only — the caller supplies already-localized axis labels, the
 * per-axis value, the shared max, and the fill colour.
 */

export interface RadarAxis {
  label: string;
  /** Value on the shared 0..max scale. */
  value: number;
}

export interface RadarChartProps {
  axes: RadarAxis[];
  max?: number;
  /** Polygon stroke + fill colour (hex or `var(--token)`). */
  color: string;
  /** Square px size of the plot area (labels extend beyond). */
  size?: number;
  ariaLabel: string;
}

const GRID = 'var(--border-subtle)';
const RINGS = 4;

function point(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  // Start at top (−90°), go clockwise.
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function RadarChart({ axes, max = 5, color, size = 260, ariaLabel }: RadarChartProps) {
  const n = axes.length;
  if (n < 3) return null; // radar needs ≥3 axes; caller falls back to bars

  const pad = 54; // room for labels
  const box = size + pad * 2;
  const cx = box / 2;
  const cy = box / 2;
  const r = size / 2;

  const ring = (frac: number) =>
    axes.map((_, i) => point(cx, cy, r * frac, i, n).join(',')).join(' ');

  const valuePts = axes.map((ax, i) => {
    const frac = max > 0 ? Math.max(0, Math.min(1, ax.value / max)) : 0;
    return point(cx, cy, r * frac, i, n);
  });
  const valuePoly = valuePts.map((p) => p.join(',')).join(' ');

  return (
    <svg width="100%" viewBox={`0 0 ${box} ${box}`} role="img" aria-label={ariaLabel} style={{ maxWidth: box }}>
      {/* concentric grid rings */}
      {Array.from({ length: RINGS }, (_, k) => (
        <polygon key={k} points={ring((k + 1) / RINGS)} fill="none" stroke={GRID} strokeWidth={1} opacity={0.6} />
      ))}
      {/* spokes */}
      {axes.map((_, i) => {
        const [x, y] = point(cx, cy, r, i, n);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={GRID} strokeWidth={1} opacity={0.5} />;
      })}
      {/* value polygon */}
      <polygon points={valuePoly} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {valuePts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3.5} fill={color} />
      ))}
      {/* axis labels */}
      {axes.map((ax, i) => {
        const [lx, ly] = point(cx, cy, r + 20, i, n);
        const anchor = Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end';
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            style={{ fontSize: 11, fontWeight: 600, fill: 'var(--text-secondary)' }}
          >
            {ax.label.length > 22 ? `${ax.label.slice(0, 21)}…` : ax.label}
          </text>
        );
      })}
    </svg>
  );
}
