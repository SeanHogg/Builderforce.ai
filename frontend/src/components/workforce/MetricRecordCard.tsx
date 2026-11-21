import type { ReactNode } from 'react';

/**
 * MetricRecordCard — the Card-mode body the Performance-tab collections share
 * (scorecards, engagement, EMP lenses, contributors). A per-member record reads
 * as a titled card with a labelled stat grid, not as a table row squashed into a
 * box. Theme tokens only; the stat grid wraps so it never overflows at 360px.
 */
export interface MetricStat {
  label: string;
  value: ReactNode;
  color?: string;
  /** Emphasise the headline figure (score, cost, composite…). */
  strong?: boolean;
}

export interface MetricRecordCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned badge/headline next to the title. */
  badge?: ReactNode;
  stats?: MetricStat[];
  /** Extra content under the stat grid (a bar, chips, an action). */
  footer?: ReactNode;
}

const statGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
  gap: 8,
};

export function MetricRecordCard({ title, subtitle, badge, stats, footer }: MetricRecordCardProps) {
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-strong)', overflowWrap: 'anywhere' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {badge && <div style={{ flexShrink: 0 }}>{badge}</div>}
      </div>
      {stats && stats.length > 0 && (
        <dl style={{ ...statGrid, margin: 0 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ minWidth: 0 }}>
              <dt style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</dt>
              <dd style={{ margin: 0, fontSize: s.strong ? 16 : 13, fontWeight: s.strong ? 700 : 500, color: s.color ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {footer}
    </div>
  );
}

/** Pill used for a record's headline badge (tier, level, kind). */
export function MetricPill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
      color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 36%, transparent)`,
    }}>
      {children}
    </span>
  );
}

/** Ascending numeric compare that sorts nulls last. */
export function cmpNum(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}
