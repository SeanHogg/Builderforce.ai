'use client';

/**
 * Founder KPI widgets (PRD 25 A4) — runway projection, ownership donut, peer
 * cohort position. Same ComponentDef shape as FINANCE_COMPONENTS.
 *
 * Capability is insights.finance so the finance hub (and Insights) can render
 * them; drill lands on the finance panel. Null / unseeded states render as
 * muted "not measured", never as a zero that looks like a fact.
 */

import { useTranslations } from 'next-intl';
import {
  RUNWAY_CRITICAL_MONTHS,
  RUNWAY_WATCH_MONTHS,
} from '@builderforce/creation-canvas-contract';
import { DonutChart } from '@/components/charts/DonutChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { WidgetMuted, WidgetStat, useSourceState } from '@/components/widgets/widgetBody';
import { useFormat } from '@/i18n/useFormat';
import { financeApi } from '@/lib/financeApi';
import { benchmarkingApi } from '@/lib/benchmarkingApi';
import { apiRequest } from '@/lib/api';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import type { ComponentDef, ComponentSurfaceProps } from '@/lib/components/types';

const FIN_CAP = 'insights.finance';
const FIN_DRILL = { kind: 'panel' as const, hub: 'finance', panel: 'finance' };

function bandColor(months: number | null): string {
  if (months == null) return 'var(--text-secondary)';
  if (months <= RUNWAY_CRITICAL_MONTHS) return 'var(--danger)';
  if (months <= RUNWAY_WATCH_MONTHS) return 'var(--warning, #c9a227)';
  return 'var(--success, #2f9e44)';
}

function RunwayProjection({ days }: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const fmt = useFormat();
  const source = useSharedSource(['founder', 'runway', days], () => financeApi.runway());
  const state = useSourceState(source);
  if (state) return state;
  const report = source.data;
  const months = report?.observed.months ?? [];
  const labels = months.map((m) => m.month);
  const series = months.map((m) => m.cash);
  const runwayMonths = report?.declared?.runway?.runwayMonths ?? report?.observed.runwayMonths ?? null;
  if (!months.length && runwayMonths == null) {
    return <WidgetMuted>{t('empty.noData')}</WidgetMuted>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <WidgetStat
        value={runwayMonths == null ? '—' : `${runwayMonths}`}
        hint={t('title.founderRunway')}
        tone={bandColor(runwayMonths)}
      />
      {labels.length > 0 && (
        <TrendChart
          labels={labels}
          series={[{ name: 'cash', values: series.map((v) => v ?? 0) }]}
          height={120}
          formatValue={(n) => fmt.currency(n)}
          area
        />
      )}
    </div>
  );
}

interface CapTablePayload {
  holders: Array<{ holderName: string; percentFullyDiluted: number; instrument: string }>;
  fullyDiluted: number;
}

function Ownership({ days }: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const fmt = useFormat();
  const source = useSharedSource(['founder', 'cap-table', days], () =>
    apiRequest<CapTablePayload>('/api/equity/cap-table'),
  );
  const state = useSourceState(source);
  if (state) return state;
  const holders = source.data?.holders ?? [];
  if (!holders.length) return <WidgetMuted>{t('empty.noData')}</WidgetMuted>;
  const segments = holders.slice(0, 8).map((h) => ({
    label: h.holderName,
    value: h.percentFullyDiluted,
  }));
  const founder = holders.find((h) => h.instrument !== 'option') ?? holders[0];
  return (
    <DonutChart
      segments={segments}
      size={160}
      thickness={22}
      centerValue={founder ? founder.percentFullyDiluted : 0}
      centerLabel={founder?.holderName ?? ''}
      formatValue={(n) => fmt.percent(n)}
      legend
    />
  );
}

function BenchPosition({ days }: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const ti = useTranslations('insights');
  const source = useSharedSource(['founder', 'bench', days], () => benchmarkingApi.get());
  const state = useSourceState(source);
  if (state) return state;
  const result = source.data;
  if (!result?.cohortSeeded) {
    return <WidgetMuted>{ti('benchmarking.noCohort')}</WidgetMuted>;
  }
  const metrics = result.metrics ?? [];
  const first = metrics[0];
  if (!first) return <WidgetMuted>{t('empty.noData')}</WidgetMuted>;
  return (
    <WidgetStat
      value={first.percentile == null ? '—' : `${first.percentile}`}
      hint={first.rating ?? first.label ?? t('title.benchPosition')}
    />
  );
}

export const FOUNDER_COMPONENTS: ComponentDef[] = [
  { id: 'founder.runway-projection', group: 'founder', titleKey: 'founderRunway', capability: FIN_CAP, size: 'md', Surface: RunwayProjection, drill: FIN_DRILL },
  { id: 'founder.ownership', group: 'founder', titleKey: 'founderOwnership', capability: FIN_CAP, size: 'md', Surface: Ownership, drill: FIN_DRILL },
  { id: 'bench.position', group: 'founder', titleKey: 'benchPosition', capability: FIN_CAP, size: 'sm', Surface: BenchPosition, drill: FIN_DRILL },
];
