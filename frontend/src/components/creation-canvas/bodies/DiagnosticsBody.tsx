import { useTranslations } from 'next-intl';
import type { CreationNodeData } from '../types';
import styles from '../CreationCanvas.module.css';
import { Icon } from '@/components/ui/Icon';
import { PageAuditFindings } from '../QaObjectViews';
import type { CreationBodyProps } from './types';
import { ProjectQualitySummary } from './ProjectBody';
import { asRecord, textValue, authoredText } from './shared';

type CanvasDiagnostic = {
  id: string;
  title: string;
  detail: string;
  severity: string;
  result: string;
  nextStep: string;
  location: string;
};

function diagnosticText(item: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function diagnosticItems(data: CreationNodeData, fallbackTitle: (index: number) => string, locationLine: (line: string) => string): CanvasDiagnostic[] {
  const source = [data.diagnostics, data.findings, data.checks, data.items]
    .flatMap((value) => Array.isArray(value) ? value : []);
  const normalized = source.map((value, index) => {
    const item = asRecord(value, { message: typeof value === 'string' ? value : fallbackTitle(index + 1) });
    const line = diagnosticText(item, ['line']);
    const path = diagnosticText(item, ['path', 'file', 'source']);
    return {
      id: diagnosticText(item, ['id', 'checkId', 'code']) || String(index),
      title: diagnosticText(item, ['title', 'message', 'issue', 'name', 'check', 'label']) || fallbackTitle(index + 1),
      detail: diagnosticText(item, ['detail', 'description', 'evidence', 'content']),
      severity: diagnosticText(item, ['severity', 'level', 'type']) || 'info',
      result: diagnosticText(item, ['result', 'outcome', 'status', 'actual']),
      nextStep: diagnosticText(item, ['nextStep', 'recommendation', 'remediation', 'action', 'fix']),
      location: [path, line ? locationLine(line) : ''].filter(Boolean).join(' · '),
    };
  });
  return normalized.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id && candidate.title === item.title && candidate.detail === item.detail) === index);
}

function diagnosticList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    const record = asRecord(item, {});
    const text = diagnosticText(record, ['title', 'message', 'step', 'action', 'recommendation', 'result', 'status']);
    return text ? [text] : [];
  });
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

export function DiagnosticsBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const diagnostics = diagnosticItems(data, (index) => t('diagnosticIndex', { index }), (line) => t('atLine', { line }));
  const explicitResults = diagnosticList(data.results);
  const topResult = textValue(data.result, textValue(data.summary, textValue(data.verdict, authoredText(data) || '')));
  const results = [...(topResult ? [topResult] : []), ...explicitResults];
  const nextSteps = [
    ...diagnosticList(data.nextSteps),
    ...diagnosticList(data.recommendations),
    ...diagnosticList(data.actions),
    ...diagnosticList(data.remediation),
    ...diagnostics.map((item) => item.nextStep).filter(Boolean),
    ...(Array.isArray(data.diagnostics) ? data.diagnostics.flatMap((value) => {
      const item = asRecord(value, {});
      return diagnosticList(item.recommendations);
    }) : []),
  ].filter((step, index, all) => all.indexOf(step) === index);
  const issueCount = data.gapCount == null ? diagnostics.filter((item) => !/^(hint|info|information|passed|pass|success|ok)$/i.test(item.severity) && !/^(passed|pass|success|ok)$/i.test(item.result)).length : Number(data.gapCount);
  const hasResults = results.length > 0 || diagnostics.some((item) => item.result);

  return <div className={styles.canvasDiagnosticsBody}>
    {data.qualityScore != null && <ProjectQualitySummary data={data} />}
    {/* Decides its own visibility — null when this diagnostic carries no page audit. */}
    <PageAuditFindings data={data} />
    <div className={styles.diagnosticOverview}>
      <span><small>{t('checks')}</small><b>{diagnostics.length}</b></span>
      <span><small>{t('issues')}</small><b>{issueCount}</b></span>
      <span><small>{t('nextSteps')}</small><b>{nextSteps.length}</b></span>
    </div>
    <div className={styles.diagnosticColumns}>
      <section aria-label={t('diagnosticsFindings')}>
        <h4>{t('diagnosticsHeading')}</h4>
        <div className={styles.diagnosticList}>{diagnostics.length ? diagnostics.map((item) => <article key={item.id} data-severity={item.severity.toLowerCase()}>
          <span aria-hidden>{/^(error|critical|high)$/i.test(item.severity) ? '×' : /^(warning|warn|medium)$/i.test(item.severity) ? '!' : /^(passed|pass|success|ok)$/i.test(item.severity) ? '✓' : 'i'}</span>
          <div><b>{item.title}</b>{item.detail && <p>{item.detail}</p>}{item.location && <small>{item.location}</small>}</div>
        </article>) : <p className={styles.diagnosticEmpty}>{t('noDiagnosticsRecorded')}</p>}</div>
      </section>
      <section aria-label={t('diagnosticResults')}>
        <h4>{t('resultsHeading')}</h4>
        <div className={styles.diagnosticList}>{hasResults ? <>
          {results.map((result, index) => <article key={`${result}-${index}`} data-severity="result"><span aria-hidden><Icon source="✓" size="1em" /></span><div><b>{result}</b></div></article>)}
          {diagnostics.filter((item) => item.result).map((item) => <article key={`result-${item.id}`} data-severity="result"><span aria-hidden>→</span><div><b>{item.title}</b><p>{item.result}</p></div></article>)}
        </> : <p className={styles.diagnosticEmpty}>{t('runDiagnostics')}</p>}</div>
      </section>
      <section aria-label={t('diagnosticNextSteps')}>
        <h4>{t('nextSteps')}</h4>
        <ol className={styles.diagnosticSteps}>{nextSteps.length ? nextSteps.map((step, index) => <li key={`${step}-${index}`}><span>{index + 1}</span><p>{step}</p></li>) : <li className={styles.diagnosticEmpty}>{t('noFollowUp')}</li>}</ol>
      </section>
    </div>
  </div>;
}
