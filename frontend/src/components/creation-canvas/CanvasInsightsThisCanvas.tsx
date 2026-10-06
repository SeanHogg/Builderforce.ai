// No 'use client' directive: rendered only inside `CreationCanvas`, which declares it.
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { boardMetricReadings, orderMetricReadings, summarizeMetricReadings } from '@/lib/canvas/boardMetrics';
import { BoardMetricReadingList } from './BoardMetricReadingList';
import { useCanvasBoardBridge } from './canvasBoardBridge';
import { useLetBrain } from './phase/CanvasPhaseContext';
import styles from './CreationCanvas.module.css';

/**
 * "THIS CANVAS" — the board's own metrics, ahead of the workspace's pinned widgets.
 *
 * Insights used to open on the tenant's pinned widgets, so a session in Measure read
 * everything EXCEPT the metrics defined on its own board. This leads with those: the same
 * readings the room's metrics station shows (`BoardMetricReadingList`), behind-target
 * first. With no metric on the board it says so and offers the one press that fixes it,
 * through the canvas's one turn door.
 *
 * Reads the board through the bridge every station already uses — no new prop.
 */
export function CanvasInsightsThisCanvas() {
  const t = useTranslations('creationCanvas.surface.insights');
  const board = useCanvasBoardBridge();
  const letBrain = useLetBrain();
  const objects = board?.objects;
  const readings = useMemo(() => (objects ? orderMetricReadings(boardMetricReadings(objects)) : []), [objects]);
  const summary = useMemo(() => summarizeMetricReadings(readings), [readings]);
  if (!board) return null;
  return (
    <section className={styles.insightsThisCanvas} aria-labelledby="canvas-insights-this-canvas" data-testid="canvas-insights-this-canvas">
      <h2 id="canvas-insights-this-canvas" className={styles.insightsSectionHeading}>{t('thisCanvas')}</h2>
      {readings.length
        ? <BoardMetricReadingList readings={readings} summary={summary} />
        : <div className={styles.insightsEmpty} role="status">
          <strong>{t('noBoardMetric')}</strong>
          {letBrain && <button type="button" className={styles.phasePathButton} data-primary="true" onClick={() => letBrain.runRequirement('metric')}>
            {letBrain.requirementLabel('metric')}
          </button>}
        </div>}
    </section>
  );
}
