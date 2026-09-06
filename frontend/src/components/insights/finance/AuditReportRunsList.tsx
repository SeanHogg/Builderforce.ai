'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { faultMessage } from '@/lib/apiClient';
import { listAuditReportRuns, type AuditReportRun } from '@/lib/finopsApi';

/**
 * The audit-report EXPORT LOG — every point-in-time report an auditor took away
 * (`audit_report_runs`), newest first. Self-contained: fetches its own data and
 * re-fetches whenever `refreshKey` changes, which is the one contract the export
 * control needs — bump it after a download completes.
 */
export function AuditReportRunsList({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useTranslations('finops');
  const fmt = useFormat();
  const [runs, setRuns] = useState<AuditReportRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listAuditReportRuns()
      .then((rows) => { if (!cancelled) setRuns(rows); })
      .catch((e) => { if (!cancelled) setError(faultMessage(e, t('auditRuns.error')) ?? t('auditRuns.error')); });
    return () => { cancelled = true; };
  }, [refreshKey, t]);

  const usd = (n: number) => fmt.currency(n, 'USD', { maximumFractionDigits: 0 });

  return (
    <section style={card} aria-labelledby="audit-runs-title">
      <h3 id="audit-runs-title" style={{ margin: '0 0 2px', fontSize: 'var(--font-size-card-title)' }}>{t('auditRuns.title')}</h3>
      <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('auditRuns.subtitle')}</p>

      {error && <div role="alert" style={{ color: 'var(--danger-text)' }}>{error}</div>}
      {!error && runs === null && <div style={{ color: 'var(--text-secondary)' }}>{t('auditRuns.loading')}</div>}
      {!error && runs && runs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>{t('auditRuns.empty')}</div>}

      {!error && runs && runs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>{t('auditRuns.period')}</th>
                <th style={th}>{t('auditRuns.generatedAt')}</th>
                <th style={th}>{t('auditRuns.by')}</th>
                <th style={th}>{t('auditRuns.format')}</th>
                <th style={thNum}>{t('auditRuns.spend')}</th>
                <th style={thNum}>{t('auditRuns.forecast')}</th>
                <th style={thNum}>{t('auditRuns.capex')}</th>
                <th style={thNum}>{t('auditRuns.socCoverage')}</th>
                <th style={thNum}>{t('auditRuns.events')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td style={td}>{run.periodMonth}</td>
                  <td style={td}>{fmt.dateTime(run.createdAt)}</td>
                  <td style={td}>{run.generatedBy ?? t('auditRuns.system')}</td>
                  <td style={td}><span style={badge}>{run.summary?.format ?? '—'}</span></td>
                  <td style={tdNum}>{run.summary ? usd(run.summary.spendUsd) : '—'}</td>
                  <td style={tdNum}>{run.summary ? usd(run.summary.forecastUsd) : '—'}</td>
                  <td style={tdNum}>{run.summary ? usd(run.summary.capexUsd) : '—'}</td>
                  <td style={tdNum}>{run.summary ? `${Math.round(run.summary.socCoveragePct)}%` : '—'}</td>
                  <td style={tdNum}>{run.summary ? fmt.number(run.summary.complianceEvents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, background: 'var(--surface)', color: 'var(--text-primary)' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 'var(--font-size-body)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const badge: React.CSSProperties = { fontSize: 'var(--font-size-small)', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', textTransform: 'uppercase' };
