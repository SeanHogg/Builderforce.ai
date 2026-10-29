import type { JSX, ReactNode } from 'react';

/** Value colour of a {@link StatTile}. Theme tokens only; `accent` is the brand colour. */
export type StatTileTone = 'success' | 'error' | 'warning' | 'accent';

const STAT_TILE_TONE_COLOR: Record<StatTileTone, string> = {
  success: 'var(--success)',
  error: 'var(--error)',
  warning: 'var(--warning)',
  accent: 'var(--accent)',
};

/**
 * One headline number. Shared by every admin panel that answers with a row of
 * stats — the same tile at different scopes, so a funnel, a visitor drawer and
 * a growth graph cannot drift on padding, type or colour.
 *
 * `tone` colours the value only. The label and hint stay muted so a warning
 * number still reads as a number, not as a banner.
 */
export function StatTile({
  label,
  value,
  hint,
  tone,
  footer,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: StatTileTone;
  /** Drawn under the hint — e.g. the Insights home's sparkline. */
  footer?: ReactNode;
  /** Drawn inline beside the value — e.g. a regression chip. */
  badge?: ReactNode;
}): JSX.Element {
  const toneColor = tone ? STAT_TILE_TONE_COLOR[tone] : 'var(--text-strong)';
  return (
    <div
      style={{
        flex: '1 1 140px',
        // 0: the grid or flex row decides the width; a floor here overflowed 3-up grids at 360px.
        minWidth: 0,
        padding: '12px 14px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface-card)',
      }}
    >
      <div
        className="text-muted"
        style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: '.04em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: toneColor, marginTop: 2 }}>
        {badge == null ? (
          value
        ) : (
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <span>{value}</span>
            {badge}
          </span>
        )}
      </div>
      {hint && <div className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)', marginTop: 2 }}>{hint}</div>}
      {footer != null && <div style={{ marginTop: 4 }}>{footer}</div>}
    </div>
  );
}
