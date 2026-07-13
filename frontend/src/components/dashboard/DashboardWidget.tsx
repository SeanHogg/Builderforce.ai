'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { TrendChart } from '@/components/charts/TrendChart';
import { BarChart } from '@/components/charts/BarChart';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { colorAt } from '@/components/charts/chartColors';
import type { WidgetValue } from '@/lib/dashboardsApi';
import { InsightStat, type InsightDelta } from './InsightStat';
import { formatMetricValue, seriesDelta, deltaTone } from './metricFormat';

/**
 * DashboardWidget — renders ONE resolved {@link WidgetValue} as its chosen
 * visualization. This is the "every visualization is a component" switch for the
 * Dashboard library: a widget's `viz` selects the matching primitive
 * (stat→InsightStat, line→TrendChart, bar→BarChart, gauge→GaugeChart) and the
 * metric's date-windowed `series` (when present) feeds the trend. The library is
 * the single render path so no surface re-implements "value → chart" by hand.
 */

/** 'YYYY-MM-DD' → short 'M/D' axis label. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

/** Gauge bounds inferred from the metric unit. */
function gaugeRange(unit: string, value: number): { min: number; max: number } {
  if (unit === '%') return { min: 0, max: 100 };
  if (unit === 'score') return { min: 0, max: 1 };
  return { min: 0, max: Math.max(value * 1.33, 1) };
}

function TitledCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export function DashboardWidget({ v }: { v: WidgetValue }) {
  const t = useTranslations('dashboard');

  const title = v.title ?? v.label;
  const points = v.series ?? [];
  const values = points.map((p) => p.value);
  const color = colorAt(0);

  if (v.error) {
    return <InsightStat label={title} value="—" sub={t('unavailable')} />;
  }

  // Trend delta chip (shared derivation) — coloured by the metric's polarity.
  const d = seriesDelta(values);
  const delta: InsightDelta | null = d
    ? { label: `${d.pct > 0 ? '+' : ''}${d.pct}%`, direction: d.direction, tone: deltaTone(d.direction, v.goodWhenUp) }
    : null;

  switch (v.viz) {
    case 'line':
      return values.length > 1 ? (
        <TitledCard title={title}>
          <TrendChart
            labels={points.map((p) => shortDay(p.day))}
            series={[{ key: v.metricKey ?? v.widgetKey ?? v.label, label: v.label, values, color }]}
            height={180}
            area
            formatValue={(n) => formatMetricValue(n, v.unit)}
            ariaLabel={title}
          />
        </TitledCard>
      ) : (
        <InsightStat label={title} value={formatMetricValue(v.value, v.unit)} sub={t('noTrend')} delta={delta} />
      );

    case 'bar':
      return values.length > 1 ? (
        <TitledCard title={title}>
          <BarChart
            data={points.slice(-14).map((p) => ({ key: p.day, label: shortDay(p.day), value: p.value }))}
            monochrome
            labelWidth={48}
            formatValue={(n) => formatMetricValue(n, v.unit)}
            ariaLabel={title}
          />
        </TitledCard>
      ) : (
        <InsightStat label={title} value={formatMetricValue(v.value, v.unit)} sub={t('noTrend')} delta={delta} />
      );

    case 'gauge': {
      const range = gaugeRange(v.unit, v.value ?? 0);
      return (
        <TitledCard title={title}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GaugeChart
              value={v.value ?? 0}
              min={range.min}
              max={range.max}
              color={color}
              size={150}
              centerValue={formatMetricValue(v.value, v.unit)}
              ariaLabel={title}
            />
          </div>
        </TitledCard>
      );
    }

    case 'stat':
    default:
      return (
        <InsightStat
          label={title}
          value={formatMetricValue(v.value, v.unit)}
          sub={t('window', { days: v.days })}
          series={values.length > 1 ? values : null}
          delta={delta}
          color={color}
        />
      );
  }
}
