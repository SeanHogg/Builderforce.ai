import { useTranslations } from 'next-intl';
import { runAnomalyApi, type RunAnomalyInsights, type RunAnomalyMetric } from '@/lib/runAnomalyApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmError } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { formatDurationPrecise } from '@/lib/duration';
import { pct, useInsightFormat } from './format';

const noteStyle = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' } as const;
const subStyle = { display: 'block', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' } as const;

/**
 * Run anomalies — the runs that cost, took or failed far outside the range of the runs
 * before them (Evermind's `run.anomaly`), as ISSUES: one row per reason, ranked by how
 * many runs it hit, with the worst runs as examples and what to check. "Typical" is the
 * median of the earlier runs, so it prints ≈; a sampled window prints ≈ on its counts.
 *
 * Rendered inside the AI Effectiveness lens, on the same window and project scope.
 */
export function RunAnomaliesCard({ days, projectId }: { days: number; projectId: number | null }) {
  const t = useTranslations('insights');
  const { data, error } = usePmData<RunAnomalyInsights>(() => runAnomalyApi.get(days, projectId), [days, projectId]);
  const { usd, int } = useInsightFormat();

  const value = (metric: RunAnomalyMetric, n: number): string =>
    metric === 'cost' ? usd(n) : metric === 'duration' ? formatDurationPrecise(n) : int(n);

  const body = (() => {
    if (error) return <PmError message={error} />;
    if (!data) return <p style={noteStyle}>{t('loading')}</p>;
    if (data.scored === 0) return <p style={noteStyle}>{t('eng.anomaly.notEnough', { minRuns: data.minRuns })}</p>;
    if (data.issues.length === 0) return <p style={noteStyle}>{t('eng.anomaly.none', { scored: data.scored })}</p>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <p style={{ ...noteStyle, color: 'var(--text-secondary)' }}>
          {t(data.sampled ? 'eng.anomaly.summarySampled' : 'eng.anomaly.summary', { flagged: data.flagged, scored: data.scored })}
        </p>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('eng.anomaly.colIssue')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('eng.anomaly.colRuns')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('eng.anomaly.colShare')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('eng.anomaly.colExcess')}</th>
                <th style={thStyle}>{t('eng.anomaly.colWorst')}</th>
              </tr>
            </thead>
            <tbody>
              {data.issues.map((issue) => (
                <tr key={issue.metric} style={trStyle}>
                  <td style={{ ...tdStyle, minWidth: 180 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{t(`eng.anomaly.metric.${issue.metric}`)}</span>
                    <span style={subStyle}>{t(`eng.anomaly.hint.${issue.metric}`)}</span>
                  </td>
                  <td style={{ ...tdMutedStyle, textAlign: 'right' }}>{data.sampled ? `≈ ${int(issue.runs)}` : int(issue.runs)}</td>
                  <td style={{ ...tdMutedStyle, textAlign: 'right' }}>{pct(issue.sharePct)}</td>
                  <td style={{ ...tdMutedStyle, textAlign: 'right' }}>{usd(issue.excessCostUsd)}</td>
                  <td style={{ ...tdMutedStyle, minWidth: 200 }}>
                    {issue.examples.map((e) => (
                      <span key={e.executionId} style={{ ...subStyle, marginBottom: 4 }}>
                        {t('eng.anomaly.example', { value: value(issue.metric, e.value), typical: value(issue.metric, e.typical), model: e.model })}
                        {e.taskId != null && <> · {t('eng.anomaly.exampleTask', { id: e.taskId })}</>}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  })();

  return <PmCard title={t('eng.anomaly.title')}>{body}</PmCard>;
}
