import { useTranslations } from 'next-intl';
import type { CreationNodeData } from '../types';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { textValue, scoreTone } from './shared';

type ProjectLens = 'everything' | 'delivery' | 'metrics' | 'customer-feedback';

function projectLens(data: CreationNodeData): ProjectLens {
  return data.projectLens === 'delivery' || data.projectLens === 'metrics' || data.projectLens === 'customer-feedback'
    ? data.projectLens
    : 'everything';
}

export function ProjectBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const lens = projectLens(data);
  const status = textValue(data.status, t('active'));
  const open = Number.isFinite(Number(data.open)) ? String(Number(data.open)) : '—';
  const blocked = Number.isFinite(Number(data.blocked)) ? String(Number(data.blocked)) : '—';
  const maturity = data.maturity == null ? '3.8 / 5' : String(data.maturity);
  const velocity = data.velocity == null ? '42 pts' : `${String(data.velocity)}${typeof data.velocity === 'number' ? ' pts' : ''}`;
  const health = textValue(data.health, textValue(data.healthTier, t('onTrack')));
  const feedback = Array.isArray(data.feedback) ? data.feedback : Array.isArray(data.items) ? data.items : [];
  const quality = <ProjectQualitySummary data={data} />;

  if (lens === 'delivery') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectHealth}>
      <div><small>{t('status')}</small><b>{status}</b></div>
      <div><small>{t('openWork')}</small><b>{open}</b></div>
      <div><small>{t('blocked')}</small><b>{blocked}</b></div>
    </div>
    <p>{textValue(data.deliverySummary, data.subtitle || t('deliveryFallback'))}</p>
  </div>;

  if (lens === 'metrics') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectHealth}>
      <div><small>{t('maturity')}</small><b>{maturity}</b></div>
      <div><small>{t('velocity')}</small><b>{velocity}</b></div>
      <div><small>{t('health')}</small><b className={styles.healthy}>{health}</b></div>
    </div>
    <p>{textValue(data.metricsSummary, t('metricsFallback'))}</p>
  </div>;

  if (lens === 'customer-feedback') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectFeedback}>
      <small>{t('customerFeedback')}</small>
      {feedback.length
        ? feedback.slice(0, 4).map((item, index) => <span key={`${String(item)}-${index}`}>{typeof item === 'string' ? item : String((item as Record<string, unknown>)?.title || (item as Record<string, unknown>)?.name || t('feedbackIndex', { index: index + 1 }))}</span>)
        : <p>{textValue(data.feedbackSummary, data.subtitle || t('feedbackFallback'))}</p>}
    </div>
  </div>;

  return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectOverview}>
      <span><small>{t('status')}</small><b>{status}</b></span>
      <span><small>{t('projectContext')}</small><b>{t('everything')}</b></span>
    </div>
    <p>{data.subtitle || t('projectFallback')}</p>
  </div>;
}

export function ProjectQualitySummary({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const score = Number(data.qualityScore);
  const hasScore = data.qualityScore != null && Number.isFinite(score);
  const diagnosticCount = Number(data.diagnosticCount || (Array.isArray(data.diagnostics) ? data.diagnostics.length : 0));
  const gapCount = Number(data.gapCount || 0);
  return <section className={styles.projectQuality} data-tone={scoreTone(data.qualityScore)} aria-label={t('projectQuality')}>
    <div className={styles.qualityGauge} style={{ '--quality-score': hasScore ? Math.max(0, Math.min(100, score)) : 0 } as React.CSSProperties}>
      <strong>{hasScore ? Math.round(score) : '—'}</strong><small>{t('perHundred')}</small>
    </div>
    <div><small>{t('quality')}</small><b>{textValue(data.qualityLabel, hasScore ? (score >= 80 ? t('healthy') : score >= 60 ? t('needsAttention') : t('atRisk')) : t('notAssessed'))}</b><p>{textValue(data.qualityHeadline, diagnosticCount ? t('diagnosticsAnalyzed', { count: diagnosticCount }) : t('loadDiagnostics'))}</p></div>
    <span><b>{diagnosticCount}</b><small>{t('diagnosticsCount')}</small></span><span><b>{gapCount}</b><small>{t('openGaps')}</small></span>
  </section>;
}
