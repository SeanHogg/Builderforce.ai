import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMetricValue } from '@/lib/canvasMetrics';
import {
  boardMetricReadings,
  orderMetricReadings,
  summarizeMetricReadings,
} from '@/lib/canvas/boardMetrics';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { useCanvasBoardBridge } from '../canvasBoardBridge';
import { BoardMetricReadingList, metricReadingStatus, useMetricSetInsight, type MetricReadingStatus } from '../BoardMetricReadingList';
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

function useBoardMetrics() {
  const board = useCanvasBoardBridge();
  const objects = board?.objects;
  const readings = useMemo(() => (objects ? orderMetricReadings(boardMetricReadings(objects)) : []), [objects]);
  const summary = useMemo(() => summarizeMetricReadings(readings), [readings]);
  return { board, readings, summary };
}

function MetricsFace({ insight, tiles }: { insight: string; tiles: ReadonlyArray<{ id: string; name: string; value: string; status: MetricReadingStatus }> }) {
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
  const insight = useMetricSetInsight(summary);
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
          status: metricReadingStatus(reading),
        }))}
      />
    ),
  };
}

function MetricsBoardPanel(_props: { instance: RoomStationInstance }) {
  const { board, readings, summary } = useBoardMetrics();
  if (!board || !readings.length) return null;
  return (
    <div className={styles.panel} data-testid="metrics-board-panel">
      <BoardMetricReadingList readings={readings} summary={summary} />
    </div>
  );
}

export const metricsBoardView: RoomStationView = {
  useModel: () => useMetricsBoardModel(),
  Panel: MetricsBoardPanel,
};
