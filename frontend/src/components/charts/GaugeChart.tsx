'use client';

/**
 * Reusable speedometer / gauge — the project's "score on a dial" primitive (no
 * charting lib; hand-rolled SVG like DonutChart). A 180° arc from min→max with a
 * coloured value sweep, a needle, and a centred value. Generic so any 0–N score
 * (project health, readiness, confidence) can reuse it.
 *
 * Presentation only: the caller supplies the value, range, colour and an
 * already-localized centre label.
 */

export interface GaugeChartProps {
  /** Current value (clamped into [min, max]). */
  value: number;
  min?: number;
  max?: number;
  /** Sweep + needle colour (hex or `var(--token)`). */
  color: string;
  /** Square px width of the gauge (height ≈ 60% of this). */
  size?: number;
  /** Big centred figure (already formatted, e.g. "82"). */
  centerValue?: string;
  /** Small caption under the centre value. */
  centerLabel?: string;
  ariaLabel: string;
}

const TRACK = 'var(--border-subtle)';

/** Point on the gauge arc for a 0..1 fraction (180° sweep, left→right). */
function pointAt(cx: number, cy: number, r: number, frac: number): [number, number] {
  const a = Math.PI * (1 - frac); // π (left) → 0 (right)
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = pointAt(cx, cy, r, from);
  const [x1, y1] = pointAt(cx, cy, r, to);
  const large = to - from > 0.5 ? 1 : 0;
  // Sweep flag 1 = clockwise, which matches left→right along the top semicircle.
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function GaugeChart({
  value, min = 0, max = 100, color, size = 120, centerValue, centerLabel, ariaLabel,
}: GaugeChartProps) {
  const frac = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const stroke = Math.max(6, Math.round(size * 0.085));
  const pad = stroke / 2 + 2;
  const cx = size / 2;
  const r = cx - pad;
  const cy = r + pad; // baseline of the semicircle
  const height = cy + pad;

  const [nx, ny] = pointAt(cx, cy, r - stroke / 2, frac);

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} role="img" aria-label={ariaLabel}>
        {/* track */}
        <path d={arc(cx, cy, r, 0, 1)} fill="none" stroke={TRACK} strokeWidth={stroke} strokeLinecap="round" />
        {/* value sweep */}
        {frac > 0 && (
          <path d={arc(cx, cy, r, 0, frac)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        )}
        {/* needle + hub */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--text-primary)" strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3} fill="var(--text-primary)" />
        {centerValue != null && (
          <text x={cx} y={cy - r * 0.32} textAnchor="middle" style={{ fontSize: size * 0.2, fontWeight: 700, fill: 'var(--text-primary)' }}>
            {centerValue}
          </text>
        )}
      </svg>
      {centerLabel != null && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>{centerLabel}</span>
      )}
    </div>
  );
}
