'use client';

/**
 * Agent quality against a FIXED task set, over time.
 *
 * The drift report and the variant comparison both score whatever traffic arrived,
 * so a month-over-month move in either could be the agents or could be the tickets.
 * This panel plots the same benchmark cases scored the same way, which is the only
 * reading of "did agent quality improve" that is not confounded by workload.
 *
 * Two lines rather than one on purpose: score is the evaluator's judgement, coverage
 * is whether the answer contained what the case requires. They move apart when the
 * rubric drifts from the product, and that is worth seeing rather than averaging away.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TrendChart } from '@/components/charts/TrendChart';
import { agentBenchmarkApi, type BenchmarkReport } from '@/lib/agentBenchmarkApi';
import type { ComponentSurfaceProps } from '@/lib/components/types';
import { useErrorMessage } from '@/i18n/useErrorMessage';

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};
const stat: React.CSSProperties = { minWidth: 120 };
// The `section` role, not `page-title`: these are four supporting figures inside
// a panel that already has a title, which is the same reading `askWidget` and
// `workforceHealthWidget` give their headline numbers. `WidgetStat` is the
// page-title-sized variant for a widget whose whole body IS one number.
const statValue: React.CSSProperties = { fontSize: 'var(--font-size-section)', fontWeight: 700, lineHeight: 1.1, color: 'var(--text-primary)' };
const statLabel: React.CSSProperties = { fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' };

/** Percent, as the panel shows it everywhere. */
const pct = (value: number): string => `${Math.round(value * 100)}%`;

export function AgentBenchmarkPanel({ days }: ComponentSurfaceProps) {
  const errorMessage = useErrorMessage();
  const t = useTranslations('agentBenchmark');
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await agentBenchmarkApi.report(days));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [days, errorMessage]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div style={card}><p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('loading')}</p></div>;
  if (error) return <div style={card}><p role="alert" style={{ fontSize: 'var(--font-size-small)', color: 'var(--danger)', margin: 0 }}>{error}</p></div>;
  if (!report) return null;

  // No cases means the workspace has not opted in; say what to do rather than
  // showing an empty chart that reads as "quality is zero".
  if (report.cases.length === 0) {
    return (
      <div style={card}>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>{t('title')}</div>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('noCases')}</p>
      </div>
    );
  }

  const labels = report.points.map((p) => new Date(p.at).toLocaleDateString());
  const regressing = report.summary.regression > 0.05;

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 650, fontSize: 'var(--font-size-card-title)' }}>{t('title')}</div>
          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {t('subtitle', { cases: report.cases.length, days: report.windowDays })}
          </p>
        </div>
        <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 650, color: regressing ? 'var(--danger)' : 'var(--success)' }}>
          ● {regressing ? t('regressing', { points: pct(report.summary.regression) }) : t('steady')}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={stat}><div style={statValue}>{pct(report.summary.passRate)}</div><div style={statLabel}>{t('statPassRate')}</div></div>
        <div style={stat}><div style={statValue}>{pct(report.summary.meanScore)}</div><div style={statLabel}>{t('statMeanScore')}</div></div>
        <div style={stat}><div style={statValue}>{pct(report.summary.meanCoverage)}</div><div style={statLabel}>{t('statMeanCoverage')}</div></div>
        <div style={stat}><div style={statValue}>{report.summary.attempts}</div><div style={statLabel}>{t('statAttempts')}</div></div>
      </div>

      {report.points.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('noAttempts')}</p>
      ) : (
        <TrendChart
          labels={labels}
          ariaLabel={t('chartLabel')}
          formatValue={pct}
          series={[
            { key: 'score', label: t('seriesScore'), values: report.points.map((p) => p.score) },
            { key: 'coverage', label: t('seriesCoverage'), values: report.points.map((p) => p.coverage) },
          ]}
        />
      )}
    </div>
  );
}
