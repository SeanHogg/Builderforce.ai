/**
 * SCALAR METRIC TILE (PRD 25 Slice B5) — one body for every single-number KPI tile
 * the SaaS and AI-native widgets share: value, benchmark band, delta, next action.
 *
 * ── NULL IS NOT ZERO ────────────────────────────────────────────────────────
 * A metric that could not be measured comes back as `value: null`. It renders as
 * the muted "Not measured" line — never as `0`, which would read as a measured,
 * terrible result (0% retention) for a founder who simply has not connected the
 * source yet.
 */

import { useTranslations } from 'next-intl';
import { dashboardsApi, type MetricScalarValue } from '@/lib/dashboardsApi';
import { benchmarkingApi, type BenchmarkingResult, type BenchmarkMetric } from '@/lib/benchmarkingApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted, useSourceState } from '@/components/widgets/widgetBody';

export type ScalarFormat = 'percent' | 'ratio' | 'months' | 'number';

export interface ScalarTileSpec {
  /** Whitelisted metric key the value is resolved from. */
  metricKey: string;
  format: ScalarFormat;
  /** Whether a higher number is the good direction (drives the delta tone). */
  higherIsBetter: boolean;
  /** Key under `components.saas.action.*` for the one-line next action. */
  actionKey: string;
}

/** One shared, deduped read of the benchmark cohort — the same source the founder tiles use. */
function useBenchmarks() {
  return useSharedSource<BenchmarkingResult>('founder:benchmarking', () => benchmarkingApi.get());
}

function useScalar(metricKey: string, days: number) {
  return useSharedSource<MetricScalarValue>(`metric:${metricKey}:${days}`, () => dashboardsApi.metricValue(metricKey, days));
}

export function ScalarMetricTile({ spec, days }: { spec: ScalarTileSpec; days: number }) {
  const t = useTranslations('components');
  const src = useScalar(spec.metricKey, days);
  const bench = useBenchmarks();
  const state = useSourceState(src);
  if (!src.data) return state;

  const { value, previous } = src.data;
  // Not measured: the muted line, and the action that makes it measurable.
  if (value == null) {
    return (
      <div>
        <Muted>{t('saas.notMeasured')}</Muted>
        <div style={{ marginTop: 6, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
          {t('saas.connectSource')}
        </div>
      </div>
    );
  }

  const display = formatScalar(value, spec.format, t);
  const band: BenchmarkMetric | undefined = bench.data?.cohortSeeded
    ? bench.data.metrics.find((m) => m.metric === spec.metricKey && m.value != null)
    : undefined;

  const delta = previous != null ? value - previous : null;
  const deltaGood = delta == null || delta === 0 ? null : (delta > 0) === spec.higherIsBetter;
  const deltaTone = deltaGood == null ? 'var(--text-muted)' : deltaGood ? 'var(--success)' : 'var(--danger)';

  return (
    <div>
      <Stat value={display} />
      {delta != null && (
        <div style={{ marginTop: 2, fontSize: 'var(--font-size-eyebrow)', color: deltaTone }}>
          {t('saas.delta', { value: `${delta > 0 ? '+' : ''}${formatScalar(delta, spec.format, t)}` })}
        </div>
      )}
      {band && (
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-small)' }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('saas.benchmark')}</span>
          <span style={{ color: 'var(--text-primary)' }}>
            {band.rating ? t(`saas.rating.${band.rating}`) : ''}
            {band.p50 != null ? ` · ${t('saas.peerMedian', { value: formatScalar(band.p50, spec.format, t) })}` : ''}
          </span>
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
        {t(`saas.action.${spec.actionKey}`)}
      </div>
    </div>
  );
}

function formatScalar(
  value: number,
  format: ScalarFormat,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (format) {
    case 'percent':
      return `${Math.round(value * 10) / 10}%`;
    case 'ratio':
      return t('saas.ratio', { value: String(Math.round(value * 10) / 10) });
    case 'months':
      return t('saas.months', { count: Math.round(value * 10) / 10 });
    default:
      return String(Math.round(value * 100) / 100);
  }
}
