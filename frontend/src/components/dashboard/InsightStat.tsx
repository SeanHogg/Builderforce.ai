'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Sparkline } from '@/components/charts/Sparkline';
import { colorAt } from '@/components/charts/chartColors';
import type { DeltaDirection } from './metricFormat';
import { TrendArrow, COLORS } from './TrendArrow';
import type { TrendClassification } from './trend';

/**
 * InsightStat — THE canonical metric card for the Dashboard library.
 *
 * Replaces the ad-hoc "metric shown as a text badge" pattern repeated across the
 * app (catalog cards, dashboards, lenses) with ONE primitive: a labelled value
 * plus the optional insight affordances — a trend sparkline, a delta chip, a
 * recency badge, an actionable nudge, and a drill-in link. Presentation-only and
 * hook-free (caller supplies already-localized strings and pre-formatted values),
 * matching the chart-primitive convention so it carries no fetch/i18n coupling.
 *
 * Gating is composed at the call site with <RoleGate>, per the product rule
 * (features are shown disabled, never hidden) — this primitive never self-hides.
 */

const TONE_COLOR: Record<'good' | 'bad' | 'neutral', string> = {
  good: 'var(--success, #16a34a)',
  bad: 'var(--danger, #dc2626)',
  neutral: 'var(--text-secondary)',
};

const DIRECTION_ARROW: Record<DeltaDirection, string> = { up: '▲', down: '▼', flat: '→' };

export interface InsightDelta {
  /** Already-formatted magnitude, e.g. "+12%". */
  label: string;
  direction: DeltaDirection;
  /** Semantic tone — colours the chip. Caller decides if up is good or bad. */
  tone?: 'good' | 'bad' | 'neutral';
}

export interface InsightStatProps {
  /** Localized metric label (the small caption). */
  label: string;
  /** Pre-formatted value, e.g. "$1,240" / "92%" / "—". */
  value: string;
  /** Optional secondary caption under the value. */
  sub?: string;
  /** Daily series → inline sparkline. Omit/empty for a scalar-only card. */
  series?: number[] | null;
  /** Trend delta chip (text-based fallback). */
  delta?: InsightDelta | null;
  /** TrendClassification from trend.ts (SVG arrow). Takes precedence over delta. */
  trendClassification?: TrendClassification | null;
  /** Localized "updated Xh ago" recency badge. */
  recencyLabel?: string | null;
  /** Actionable hint / CTA shown at the foot of the card. */
  nudge?: ReactNode;
  /** Makes the whole card a drill-in link. */
  href?: string;
  /** Accent colour for value + sparkline (defaults to the palette head). */
  color?: string;
  /** Escape hatch for a bespoke chart (back-compat with the old StatCard). */
  chart?: ReactNode;
  /** Optional polarity hint for backwards-compatibility text chips. */
  polarity?: boolean | null;
  style?: CSSProperties;
}

export function InsightStat({
  label,
  value,
  sub,
  series,
  delta,
  trendClassification,
  recencyLabel,
  nudge,
  href,
  color = colorAt(0),
  chart,
  style,
}: InsightStatProps) {
  const hasSeries = Array.isArray(series) && series.length > 1;

  const body = (
    <div
      style={{
        position: 'relative',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: 16,
        minWidth: 180,
        height: '100%',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        {recencyLabel && (
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{recencyLabel}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 2px' }}>
        <span style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
        {/* Trend indicator — SVG arrow (task #307) takes precedence over the legacy text chip. */}
        {trendClassification ? (
          <TrendArrow classification={trendClassification} size="small" />
        ) : (
          delta && (
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: TONE_COLOR[delta.tone ?? 'neutral'] }}>
              {DIRECTION_ARROW[delta.direction]} {delta.label}
            </span>
          )
        )}
      </div>

      {sub && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{sub}</div>}

      {chart
        ? <div style={{ marginTop: 10 }}>{chart}</div>
        : hasSeries && (
            <div style={{ marginTop: 10 }}>
              <Sparkline values={series as number[]} width={220} height={32} color={color} ariaLabel={label} />
            </div>
          )}

      {nudge && <div style={{ marginTop: 10, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{nudge}</div>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
        {body}
      </Link>
    );
  }
  return body;
}
