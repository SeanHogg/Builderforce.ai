'use client';

/**
 * ONE chart primitive fed by one shape (PRD 20 §7.1).
 *
 * "`metric_fact` → one chart primitive fed by one shape, which is what makes
 * *insights everywhere* affordable." Every seat's numbers arrive as
 * `{ metric, unit, points: [{ at, value }] }` from `/api/<domain>/metrics`, so a
 * surface asks its domain for its metrics and gets something renderable —
 * instead of each feature shipping a bespoke aggregate and a bespoke chart to
 * read it.
 *
 * Inline SVG, no chart library: the shape is one series of (time, number), the
 * page must stay light, and a sparkline that has to survive both themes is
 * easier to get right with tokens than with a library's own palette.
 *
 * DECIDES ITS OWN VISIBILITY. A series with fewer than two points cannot be a
 * line, so it renders the single value as a stat rather than an empty axis, and
 * a series with no points renders nothing at all.
 */

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { MetricSeries } from '@/lib/kernel/kernelApi';
import { formatCents } from '@/lib/canvasMoney';
import { useFormat } from '@/i18n/useFormat';

/** Series index → token. Four hues, cycled — enough to tell three or four lines
 *  apart without inventing a palette that only reads in one theme. */
const SERIES_TOKENS = [
  'var(--accent)',
  'var(--cyan-bright)',
  'var(--badge-unread)',
  'var(--warning)',
];

function path(points: { at: string; value: number }[], w: number, h: number, pad: number): string {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / Math.max(points.length - 1, 1);
  return points
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((p.value - min) / span) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function formatValue(value: number, unit: string | null, locale: string): string {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  if (!unit) return n;
  if (unit === 'cents') {
    return formatCents(value, { locale });
  }
  if (unit === 'percent') return `${n}%`;
  return `${n} ${unit}`;
}

export function MetricChart({
  series,
  height = 120,
  locale,
}: {
  series: MetricSeries[];
  height?: number;
  /** Defaults to the reader's active locale. */
  locale?: string;
}) {
  const t = useTranslations('kernel.chart');
  const fmt = useFormat();
  // The prop still wins when a caller pins a locale; otherwise follow the reader
  // rather than the machine, which is what an omitted `locale` used to mean.
  const activeLocale = locale ?? fmt.locale;
  const gradientId = useId();
  const live = series.filter((s) => s.points.length > 0);

  if (live.length === 0) {
    return <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('empty')}</p>;
  }

  const width = 600;
  const pad = 8;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* The stat row. Every series leads with its latest value, so a surface
          reads as numbers first and shape second — a chart nobody can read a
          number off is decoration. */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {live.map((s, i) => {
          const last = s.points[s.points.length - 1]!;
          const first = s.points[0]!;
          const delta = first.value === 0 ? null : ((last.value - first.value) / Math.abs(first.value)) * 100;
          return (
            <div key={s.metric} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="rounded-full" style={{ width: 7, height: 7, background: SERIES_TOKENS[i % SERIES_TOKENS.length] }} />
                <span className="text-xs uppercase tracking-wider truncate" style={{ color: 'var(--text-muted)' }}>
                  {s.metric.split('.').slice(1).join('.') || s.metric}
                </span>
              </div>
              <p className="m-0 text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {formatValue(last.value, s.unit, activeLocale)}
              </p>
              {delta !== null ? (
                <p
                  className="m-0 text-xs tabular-nums"
                  style={{ color: delta >= 0 ? 'var(--success, var(--success))' : 'var(--danger-text, var(--error-text))' }}
                >
                  {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Wide content scrolls inside its OWN container — the page body never
          scrolls horizontally. */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          role="img"
          aria-label={t('ariaLabel', { count: live.length })}
          style={{ display: 'block', minWidth: 240 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Baseline, in a token so it reads in both themes. */}
          <line
            x1={pad} y1={height - pad} x2={width - pad} y2={height - pad}
            stroke="var(--border-subtle)" strokeWidth="1"
          />
          {live.map((s, i) => {
            const d = path(s.points, width, height, pad);
            const token = SERIES_TOKENS[i % SERIES_TOKENS.length];
            return (
              <g key={s.metric}>
                {i === 0 ? (
                  <path d={`${d} L${width - pad},${height - pad} L${pad},${height - pad} Z`} fill={`url(#${gradientId})`} />
                ) : null}
                <path d={d} fill="none" stroke={token} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
