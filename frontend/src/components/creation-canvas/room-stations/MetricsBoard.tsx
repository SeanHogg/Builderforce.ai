import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Sparkline } from '@/components/charts/Sparkline';
import { formatMetricValue } from '@/lib/canvasMetrics';
import {
  boardMetricReadings,
  orderMetricReadings,
  summarizeMetricReadings,
  type BoardMetricReading,
} from '@/lib/canvas/boardMetrics';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { useCanvasBoardBridge } from '../canvasBoardBridge';
import type { RoomStationModel, RoomStationView } from './types';
import styles from './roomStations.module.css';

/**
 * THE METRICS BOARD — the session's metric set, evaluated once by the semantic layer
 * (`canvasMetrics.computeMetricSet`) and read as an insight before it is read as tiles:
 * what is behind target leads, what could not be computed says why and never shows a
 * zero. Every number carries its evidence (rows it was computed from, or the metrics a
 * derived one is made of), because a figure on a wall that cannot say where it came
 * from is decoration.
 *
 * Entitlement: anyone who can see the board sees what it measures. The station stands
 * only once the session defines a metric (`roomStations.ts`); with none, null.
 */

type Status = 'ahead' | 'on-track' | 'behind' | 'none' | 'error';

function statusOf(reading: BoardMetricReading): Status {
  if (reading.error) return 'error';
  return reading.value.status ?? 'none';
}

function useBoardMetrics() {
  const board = useCanvasBoardBridge();
  const objects = board?.objects;
  const readings = useMemo(() => (objects ? orderMetricReadings(boardMetricReadings(objects)) : []), [objects]);
  const summary = useMemo(() => summarizeMetricReadings(readings), [readings]);
  return { board, readings, summary };
}

function useInsight(summary: ReturnType<typeof summarizeMetricReadings>): string {
  const t = useTranslations('roomStations.metrics');
  const head = summary.withTarget ? t('summary', { behind: summary.behind }) : t('noTargets');
  return summary.errored ? `${head} ${t('errored', { count: summary.errored })}` : head;
}

function MetricsFace({ insight, tiles }: { insight: string; tiles: ReadonlyArray<{ id: string; name: string; value: string; status: Status }> }) {
  return (
    <div className={styles.face} data-tone="calm">
      <p className={styles.faceHeadline}>{insight}</p>
      <ul className={styles.faceTiles}>
        {tiles.map((tile) => (
          <li key={tile.id} className={styles.faceTile} data-status={tile.status}>
            <span className={styles.faceTileName}>{tile.name}</span>
            <strong className={styles.faceTileValue}>{tile.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useMetricsBoardModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.metrics');
  const locale = useLocale();
  const { board, readings, summary } = useBoardMetrics();
  const insight = useInsight(summary);
  if (!board || !readings.length) return null;
  return {
    title: t('title'),
    summary: t('count', { count: readings.length }),
    face: (
      <MetricsFace
        insight={insight}
        tiles={readings.slice(0, 4).map((reading) => ({
          id: reading.definition.id,
          name: reading.definition.name,
          value: reading.error ? '—' : formatMetricValue(reading.value.value, reading.definition, locale),
          status: statusOf(reading),
        }))}
      />
    ),
  };
}

function MetricsBoardPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.metrics');
  const locale = useLocale();
  const { board, readings, summary } = useBoardMetrics();
  const insight = useInsight(summary);
  if (!board || !readings.length) return null;
  return (
    <div className={styles.panel} data-testid="metrics-board-panel">
      <p className={styles.insight} data-attention={summary.behind > 0 || summary.errored > 0 ? 'true' : 'false'}>{insight}</p>
      <ul className={styles.metrics}>
        {readings.map((reading) => {
          const status = statusOf(reading);
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
    </div>
  );
}

export const metricsBoardView: RoomStationView = {
  useModel: () => useMetricsBoardModel(),
  Panel: MetricsBoardPanel,
};
