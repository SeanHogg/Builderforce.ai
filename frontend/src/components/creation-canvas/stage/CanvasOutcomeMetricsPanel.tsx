import type { Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { CopyButton } from '@/components/CopyButton';
import type { CreationOutcomeMetric, CreationOutcomeMetrics } from '@/lib/builderforceApi';
import {
  compareOutcomeMetric,
  formatOutcomeMetric,
  groupOutcomeMetrics,
  northStarMetric,
  outcomeFamilyLabel,
  outcomeMetricDefinition,
  outcomeMetricLabel,
  type OutcomeTranslator,
} from '@/lib/outcomeMetrics';
import { CanvasAttributedOutcomes } from '../CanvasAttributedOutcomes';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import type { useCanvasDiagnostics } from '../hooks/useCanvasDiagnostics';
import styles from '../CreationCanvas.module.css';

export interface CanvasOutcomeMetricsPanelProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  metrics: CreationOutcomeMetrics | null;
  loading: boolean;
  error: string | null;
  /** Fetch again — the panel's Retry. */
  onRetry: () => void;
  buildProofJourneyDiagnostics: ReturnType<typeof useCanvasDiagnostics>['buildProofJourneyDiagnostics'];
}

/** The north star first, then the acts of the method in order. */
function OutcomeMetricList({ metrics }: { metrics: CreationOutcomeMetrics }) {
  const t = useTranslations('creationCanvas');
  /** The shared metric vocabulary — labels, units and comparisons, identical to
   *  the superadmin Value outcomes panel. See `lib/outcomeMetrics.ts`. */
  const outcomeText = useTranslations('outcomeMetrics') as unknown as OutcomeTranslator;
  // The north star leads, then the acts of the method in order. A flat
  // list said "graded a kill condition" and "published something" were
  // the same kind of news, which is the one claim this method denies.
  const northStar = northStarMetric(metrics.metrics, metrics.northStarKey);
  const groups = groupOutcomeMetrics(metrics.metrics, metrics.families ?? []);
  const renderMetric = (metric: CreationOutcomeMetric) => {
    const change = compareOutcomeMetric(outcomeText, metric);
    return <article key={metric.key} className={styles.outcomeMetric}>
      <div><strong title={outcomeMetricDefinition(outcomeText, metric)}>{outcomeMetricLabel(outcomeText, metric)}</strong><span>{formatOutcomeMetric(outcomeText, metric.current, metric.unit)}</span></div>
      <small>{metric.baseline == null ? t('baselineGathering') : t('typicalValue', { value: formatOutcomeMetric(outcomeText, metric.baseline, metric.unit) })}{change.delta != null && change.delta !== 0 ? <em data-positive={change.favorable}>{change.favorable ? <Icon source="↗" size="1em" /> : <Icon source="↘" size="1em" />}</em> : null}</small>
    </article>;
  };
  return <div className={styles.outcomeMetricList}>
    {northStar && <div className={styles.outcomeNorthStar}>
      <b>{t('northStar')}</b>
      <strong>{outcomeMetricLabel(outcomeText, northStar)}</strong>
      <span>{formatOutcomeMetric(outcomeText, northStar.current, northStar.unit)}</span>
      <small>{outcomeMetricDefinition(outcomeText, northStar)}</small>
      <small>{compareOutcomeMetric(outcomeText, northStar).label}</small>
    </div>}
    {groups.map((group) => <section key={group.family.key}>
      <h3 className={styles.outcomeFamily}>{outcomeFamilyLabel(outcomeText, group.family)}</h3>
      {group.metrics.map(renderMetric)}
    </section>)}
  </div>;
}

export function CanvasOutcomeMetricsPanel({ open, setOpen, metrics, loading, error, onRetry, buildProofJourneyDiagnostics }: CanvasOutcomeMetricsPanelProps) {
  const t = useTranslations('creationCanvas');
  const { sessionId, persistence, requireAccount } = useCanvasSessionFacts();
  if (!open) return null;
  return <aside className={`${styles.historyPanel} ${styles.outcomeMetricsPanel}`} aria-label={t('sessionOutcomeMetrics')}>
          <header><div><strong>{t('ideaToDelivery')}</strong><small>{metrics ? t('sessionVsTenant', { count: metrics.sampleSize }) : t('valueGenerated')}</small></div><span className={styles.panelHeaderActions}>{persistence === 'server' && <CopyButton compact label={t('copyDiagnostics')} ariaLabel={t('copyProofJourneyDiagnostics')} getText={buildProofJourneyDiagnostics} />}<button onClick={() => setOpen(false)} aria-label={t('closeOutcomeMetrics')}>×</button></span></header>
          {persistence === 'local' ? <div className={styles.outcomeEmpty}><span aria-hidden><Icon source="↗" size="1em" /></span><strong>{t('saveForBaseline')}</strong><p>{t('saveForBaselineHint')}</p><button className={styles.primaryButton} onClick={() => requireAccount('metrics', t('gateMetricsTitle'), t('gateMetricsBody'))}>{t('saveAndMeasure')}</button></div> : loading ? <p role="status">{t('calculatingValue')}</p> : error ? <div className={styles.outcomeEmpty}><strong>{t('metricsUnavailable')}</strong><p>{error}</p><button className={styles.secondaryButton} onClick={onRetry}>{t('retry')}</button></div> : metrics ? <OutcomeMetricList metrics={metrics} /> : null}
          {/* The OTHER half. Everything above measures the PROCESS — how fast and
              how reliably this board produced something — which on its own is a
              productivity report. This reads the ATTRIBUTED facts beside it (the
              `session:`/`site:` dimensioned series the growth and canvas rollups
              already stamp), so the panel can also answer the question the founder
              actually opened it for: did the thing I built do anything for anyone. */}
          {persistence === 'server' && <CanvasAttributedOutcomes sessionId={sessionId} />}
          <footer><span>{t('correlationCoverage')}</span><small>{t('aggregatesScoped')}</small></footer>
        </aside>;
}
