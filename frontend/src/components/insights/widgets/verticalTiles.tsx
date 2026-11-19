/**
 * Shared bodies for the vertical KPI widgets (PRD 25 Slice D).
 *
 * Every vertical widget is a group of whitelisted metric keys read through ONE
 * typed client (`dashboardsApi.metricValue`), deduped per (key, window) by
 * `useSharedSource`. `null` is rendered "Not measured" with the connect-source
 * hint — never as 0.
 */

import { useTranslations } from 'next-intl';
import { dashboardsApi, type MetricScalarValue } from '@/lib/dashboardsApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import { useFormat } from '@/i18n/useFormat';
import type { ComponentDef, ComponentDrill, ComponentSurfaceProps } from '@/lib/components/types';
import { StageBar } from './StageBar';

export const VERTICAL_DRILL: ComponentDrill = { kind: 'panel', hub: 'finance', panel: 'finance' };
export const VERTICAL_CAP = 'insights.finance' as const;

/** One shared, deduped read of a metric's scalar value. */
export function useMetric(key: string, days: number) {
  return useSharedSource<MetricScalarValue>(`vertical:${key}:${days}`, () => dashboardsApi.metricValue(key, days));
}

/** Format a scalar by its server-declared unit. */
function useFormatMetric() {
  const fmt = useFormat();
  const t = useTranslations('components');
  return (v: MetricScalarValue): string => {
    if (v.value == null) return t('vertical.notMeasured');
    switch (v.unit) {
      case 'USD': return fmt.money(v.value);
      case '%': return `${fmt.number(Math.round(v.value * 10) / 10)}%`;
      case 'x': return `${fmt.number(Math.round(v.value * 10) / 10)}×`;
      case '': return fmt.number(v.value);
      default: return `${fmt.number(Math.round(v.value * 10) / 10)} ${v.unit}`;
    }
  };
}

/** A labelled row: metric name left, value right; "Not measured" when null. */
export function MetricRow({ metricKey, days }: { metricKey: string; days: number }) {
  const t = useTranslations('components');
  const src = useMetric(metricKey, days);
  const format = useFormatMetric();
  const measured = src.data?.value != null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--font-size-small)' }}>
      <span style={{ color: 'var(--text-muted)' }}>{src.data?.label ?? t(`vertical.metric.${metricKey}` as 'vertical.metric.x')}</span>
      <span style={{ color: measured ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: measured ? 600 : 400 }}>
        {src.error ? t('vertical.notMeasured') : src.data ? format(src.data) : t('loading')}
      </span>
    </div>
  );
}

/** A card body listing several metric rows, with the connect-source hint under it. */
export function MetricList({ keys, days }: { keys: readonly string[]; days: number }) {
  const t = useTranslations('components');
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {keys.map((k) => <MetricRow key={k} metricKey={k} days={days} />)}
      <Muted>{t('vertical.connectSource')}</Muted>
    </div>
  );
}

/** A stage tile — resolves the ordinal, takes the stage list as data. */
export function StageTile({ metricKey, stages, days, ariaLabel }: { metricKey: string; stages: readonly string[]; days: number; ariaLabel: string }) {
  const src = useMetric(metricKey, days);
  return <StageBar stages={stages} current={src.data?.value ?? null} ariaLabel={ariaLabel} />;
}

/** Build a ComponentDef whose body is a plain list of metric rows. */
export function metricListDef(
  id: string, group: string, titleKey: string, keys: readonly string[], size: 'sm' | 'md' | 'lg' = 'md',
): ComponentDef {
  const Surface = ({ days }: ComponentSurfaceProps) => <MetricList keys={keys} days={days} />;
  return { id, group, titleKey, capability: VERTICAL_CAP, size, Surface, drill: VERTICAL_DRILL };
}

/** Build a ComponentDef whose body is a StageBar over a stage list plus supporting rows. */
export function stageDef(
  id: string, group: string, titleKey: string, metricKey: string, stages: readonly string[], rows: readonly string[] = [],
): ComponentDef {
  const Surface = ({ days }: ComponentSurfaceProps) => {
    const t = useTranslations('components');
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <StageTile metricKey={metricKey} stages={stages} days={days} ariaLabel={t(`title.${titleKey}` as 'title.x')} />
        {rows.length > 0 && <MetricList keys={rows} days={days} />}
      </div>
    );
  };
  return { id, group, titleKey, capability: VERTICAL_CAP, size: 'md', Surface, drill: VERTICAL_DRILL };
}
