// No 'use client' directive: every importer sits inside the `CreationCanvas` boundary.
import { useLocale, useTranslations } from 'next-intl';
import { Sparkline } from '@/components/charts/Sparkline';
import { formatMetricValue } from '@/lib/canvasMetrics';
import type { BoardMetricReading, MetricSetSummary } from '@/lib/canvas/boardMetrics';
import styles from './room-stations/roomStations.module.css';

/**
 * THE BOARD'S METRICS, read — one component for every place they are read.
 *
 * The room's metrics station drew this list in its panel, and the Insights surface needs
 * the same reading under "This canvas". Two copies of a tile that renders a value, its
 * target, its trend and why it could not be computed would be two places to get the
 * "a missing COGS is never a zero" rule wrong, so both mount this.
 *
 * Takes the readings already ordered (`orderMetricReadings`) and summarised: the caller
 * owns where the board comes from, this owns how a reading looks.
 */
export type MetricReadingStatus = 'ahead' | 'on-track' | 'behind' | 'none' | 'error';

export function metricReadingStatus(reading: BoardMetricReading): MetricReadingStatus {
  if (reading.error) return 'error';
  return reading.value.status ?? 'none';
}

/** The one-line verdict over a set — "2 behind target", plus how many could not compute. */
export function useMetricSetInsight(summary: MetricSetSummary): string {
  const t = useTranslations('roomStations.metrics');
  const head = summary.withTarget ? t('summary', { behind: summary.behind }) : t('noTargets');
  return summary.errored ? `${head} ${t('errored', { count: summary.errored })}` : head;
}

export function BoardMetricReadingList({ readings, summary }: { readings: readonly BoardMetricReading[]; summary: MetricSetSummary }) {
  const t = useTranslations('roomStations.metrics');
  const locale = useLocale();
  const insight = useMetricSetInsight(summary);
  return (
    <>
      <p className={styles.insight} data-attention={summary.behind > 0 || summary.errored > 0 ? 'true' : 'false'}>{insight}</p>
      <ul className={styles.metrics}>
        {readings.map((reading) => {
          const status = metricReadingStatus(reading);
          const { definition, value } = reading;
          const operands = 'operands' in value ? value.operands.length : 0;
          return (
            <li key={definition.id} className={styles.metric} data-status={status} data-testid="metric-tile">
              <div className={styles.metricHead}>
                <span className={styles.metricName}>{definition.name}</span>
                {status !== 'none' && <span className={styles.metricStatus}>{t(`status.${status}`)}</span>}
              </div>
              <p className={styles.metricValue}>{reading.error ? '—' : formatMetricValue(value.value, definition, locale)}</p>
              {!reading.error && value.target != null && (
                <p className={styles.metricTarget}>
                  {t('target', { target: formatMetricValue(value.target, definition, locale) })}
                  {value.attainment != null ? ` · ${t('attainment', { value: value.attainment })}` : ''}
                </p>
              )}
              {reading.series && (
                <div className={styles.metricTrend}>
                  <Sparkline values={reading.series} width={180} height={32} area ariaLabel={t('trend', { name: definition.name })} />
                </div>
              )}
              {reading.error
                ? <p className={styles.metricError}>{t('error', { reason: reading.error })}</p>
                : <p className={styles.metricEvidence}>{reading.derived
                  ? t('derived', { count: operands })
                  : t('evidence', { matched: value.matchedRows, total: value.totalRows })}</p>}
              {definition.description && <p className={styles.metricDescription}>{definition.description}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
