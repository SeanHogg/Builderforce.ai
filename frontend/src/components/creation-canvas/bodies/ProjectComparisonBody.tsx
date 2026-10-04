import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { Icon } from '@/components/ui/Icon';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { asRecord, scoreTone } from './shared';

export function ProjectComparisonBody({ data }: CreationBodyProps) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  const projects = Array.isArray(data.projects) ? data.projects as Array<Record<string, unknown>> : [];
  const scored = projects.filter((project) => project.qualityScore != null && Number.isFinite(Number(project.qualityScore)));
  const portfolioScore = scored.length ? Math.round(scored.reduce((sum, project) => sum + Number(project.qualityScore), 0) / scored.length) : null;
  const totalGaps = projects.reduce((sum, project) => sum + Number(project.gapCount || 0), 0);
  const recommendations: Array<Record<string, unknown> & { project: string }> = projects.flatMap((project) => Array.isArray(project.recommendations)
    ? project.recommendations.map((item) => ({ project: String(project.name || t('project')), ...asRecord(item, {}) }))
    : []).sort((a, b) => Number((a as Record<string, unknown>).score ?? 101) - Number((b as Record<string, unknown>).score ?? 101)).slice(0, 5);
  return <div className={styles.comparisonBody}>
    <section className={styles.portfolioQuality} data-tone={scoreTone(portfolioScore)} aria-label={t('portfolioQualityAria')}>
      <div><small>{t('portfolioQuality')}</small><strong>{portfolioScore == null ? '—' : portfolioScore}<em>{t('perHundred')}</em></strong><span>{t('projectsAssessed', { scored: scored.length, total: projects.length })}</span></div>
      <div><small>{t('qualityCoverage')}</small><strong>{projects.reduce((sum, project) => sum + Number(project.diagnosticCount || 0), 0)}</strong><span>{t('diagnosticResultsCount')}</span></div>
      <div><small>{t('attentionNeeded')}</small><strong>{totalGaps}</strong><span>{t('openQualityGaps')}</span></div>
    </section>
    <div className={styles.comparisonTable}>
      <b>{t('project')}</b><b>{t('quality')}</b><b>{t('diagnosticsHeading')}</b><b>{t('delivery')}</b><b>{t('openBlocked')}</b>
      {projects.flatMap((project, index) => [
        <strong key={`${index}-name`}><i data-tone={scoreTone(project.qualityScore)} />{String(project.name || t('projectIndex', { index: index + 1 }))}<small>{String(project.status || t('active'))}</small></strong>,
        <span className={styles.comparisonScore} key={`${index}-quality`}><b>{project.qualityScore == null ? '—' : Math.round(Number(project.qualityScore))}</b><i><em style={{ width: `${Math.max(0, Math.min(100, Number(project.qualityScore || 0)))}%` }} /></i><small>{String(project.qualityLabel || t('notAssessed'))}</small></span>,
        <span key={`${index}-diagnostics`}><b>{t('resultsCount', { count: Number(project.diagnosticCount || 0) })}</b><small>{t('gapsCount', { count: Number(project.gapCount || 0) })}</small></span>,
        <span key={`${index}-delivery`}><b>{Number(project.progress || 0)}%</b><small>{project.velocity == null ? t('noVelocity') : t('ptsVelocity', { points: Number(project.velocity) })}</small></span>,
        <span key={`${index}-work`}>{Number(project.open || 0)} / {Number(project.blocked || 0)}</span>,
      ])}
    </div>
    <div className={styles.diagnosticMatrix}>
      {projects.map((project, index) => <section key={`${index}-diagnostics`}><header><b>{String(project.name)}</b><span>{t('gapsCount', { count: Number(project.gapCount || 0) })}</span></header>{Array.isArray(project.diagnostics) && project.diagnostics.length ? project.diagnostics.slice(0, 5).map((raw, diagnosticIndex) => { const diagnostic = asRecord(raw, {}); return <div key={`${String(diagnostic.toolId)}-${diagnosticIndex}`}><span><Icon source={String(diagnostic.icon || 'apps')} size={14} /> {String(diagnostic.name || t('diagnostic'))}</span><b data-tone={scoreTone(diagnostic.score)}>{diagnostic.score == null ? '—' : Math.round(Number(diagnostic.score))}</b><small>{t('gapsCount', { count: Number(diagnostic.gapCount || 0) })}</small></div>; }) : <p>{t('noDiagnosticsRun')}</p>}</section>)}
    </div>
    <section className={styles.qualityRecommendations} aria-label={t('prioritizedRecommendations')}><header><b>{t('recommendedNextActions')}</b><span>{t('lowestScoringFirst')}</span></header>{recommendations.length ? recommendations.map((recommendation, index) => <article key={`${recommendation.project}-${String(recommendation.title)}-${index}`}><i>{index + 1}</i><div><b>{String(recommendation.title || t('reviewDiagnosticFinding'))}</b><p>{String(recommendation.detail || recommendation.diagnostic || '')}</p></div><span>{recommendation.project}<small>{String(recommendation.diagnostic || '')}</small></span></article>) : <p>{t('runQualityDiagnostics')}</p>}</section>
    <small>{t('freshness', { at: typeof data.fetchedAt === 'string' ? fmt.dateTime(data.fetchedAt) : t('draft') })}</small>
  </div>;
}
