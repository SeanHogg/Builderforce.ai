/**
 * HealthRing — a compact "% done" donut for a work item's health, rendered
 * identically on the web app and inside the VS Code webview. Pure presentational
 * SVG (no chart library): give it a 0–100 percent and it draws a tier-coloured
 * ring with the percentage in the centre. Colours come from `--bf-health-*`
 * theme variables (with sensible fallbacks) so it reads in light AND dark.
 */

export interface HealthRingProps {
  /** 0–100 completion. */
  percent: number;
  /** Diameter in px (default 40). */
  size?: number;
  /** Ring thickness in px (default 4). */
  stroke?: number;
  /** Optional caption under the ring (e.g. "3/8"). */
  caption?: string;
  /** Dim the ring (e.g. the ticket no longer exists). */
  muted?: boolean;
  ariaLabel?: string;
}

/** Map a completion percent to a tier colour (CSS var with hex fallback). */
export function healthRingColor(percent: number, muted = false): string {
  if (muted) return 'var(--bf-health-muted, #9ca3af)';
  if (percent >= 100) return 'var(--bf-health-done, #16a34a)';
  if (percent >= 67) return 'var(--bf-health-good, #22c55e)';
  if (percent >= 34) return 'var(--bf-health-mid, #f59e0b)';
  if (percent > 0) return 'var(--bf-health-low, #f97316)';
  return 'var(--bf-health-none, #ef4444)';
}

export function HealthRing({ percent, size = 40, stroke = 4, caption, muted = false, ariaLabel }: HealthRingProps) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = healthRingColor(pct, muted);
  const label = ariaLabel ?? `${pct}% complete`;

  return (
    <span className="bf-health-ring" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--bf-health-track, rgba(148,163,184,0.25))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash.toFixed(2)} ${(c - dash).toFixed(2)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--bf-health-text, currentColor)"
          style={{ fontSize: Math.max(9, size * 0.28), fontWeight: 600 }}
        >
          {pct}
        </text>
      </svg>
      {caption ? (
        <span style={{ fontSize: 10, color: 'var(--bf-health-caption, var(--bf-text-muted, #6b7280))', lineHeight: 1 }}>{caption}</span>
      ) : null}
    </span>
  );
}
