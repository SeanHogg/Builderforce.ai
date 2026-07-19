'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { empInsightsApi, type CrossTeamBenchmarkResult, type CrossTeamMetricKey } from '@/lib/empInsightsApi';
import { usePmData } from '@/lib/pm/usePmData';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { PmCard, PmEmpty, PmError } from '@/components/pm/pmShared';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DaysWindowSelect } from './LensShell';

/** Colour a percentile: green (leading) → red (lagging). */
function percentileColor(p: number | null): string {
  if (p == null) return 'var(--text-muted)';
  if (p >= 75) return '#059669';
  if (p >= 50) return '#2563eb';
  if (p >= 25) return '#b45309';
  return '#dc2626';
}

const METRIC_ORDER: CrossTeamMetricKey[] = ['throughput', 'avg_cycle_time_hours', 'rework_rate_pct', 'effectiveness'];

function fmtMetric(metric: CrossTeamMetricKey, value: number | null): string {
  if (value == null) return '—';
  if (metric === 'throughput') return Math.round(value).toLocaleString();
  if (metric === 'avg_cycle_time_hours') return `${value.toFixed(1)}h`;
  if (metric === 'rework_rate_pct') return `${value.toFixed(0)}%`;
  return value.toFixed(0); // effectiveness
}

/**
 * LENS — Cross-team benchmarking (EMP-5). Ranks each team against the tenant's
 * other teams (internal percentile) on the task-derived delivery metrics, with a
 * leaderboard bar of overall standing plus a per-metric percentile table.
 */
export function CrossTeamBenchmarkLens() {
  const t = useTranslations('insights.emp');
  const { currentProjectId } = useProjectScope();
  const [days, setDays] = useState(30);
  const { data, error } = usePmData<CrossTeamBenchmarkResult>(() => empInsightsApi.crossTeam(days, currentProjectId), [days, currentProjectId]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;
  if (data.teamCount === 0) return <PmEmpty message={t('crossTeam.noTeams')} />;

  const bars: BarDatum[] = data.teams
    .filter((tm) => tm.overallPercentile != null)
    .map((tm) => ({
      key: String(tm.teamId),
      label: tm.teamName,
      value: tm.overallPercentile ?? 0,
      color: percentileColor(tm.overallPercentile),
    }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      <PmCard title={t('crossTeam.leaderboard')}>
        {bars.length ? (
          <BarChart data={bars} formatValue={(v) => `${Math.round(v)}%`} ariaLabel={t('crossTeam.leaderboard')} />
        ) : (
          <PmEmpty message={t('crossTeam.noData')} />
        )}
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 12 }}>{t('crossTeam.footnote')}</p>
      </PmCard>

      <PmCard title={t('crossTeam.tableTitle')}>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('crossTeam.team')}</th>
                <th style={thStyle}>{t('crossTeam.members')}</th>
                {METRIC_ORDER.map((m) => (
                  <th key={m} style={thStyle}>{t(`crossTeam.metric.${m}`)}</th>
                ))}
                <th style={thStyle}>{t('crossTeam.overall')}</th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((tm) => {
                const byMetric = new Map(tm.metrics.map((mm) => [mm.metric, mm]));
                return (
                  <tr key={tm.teamId} style={trStyle}>
                    <td style={tdStyle}>{tm.teamName}</td>
                    <td style={tdMutedStyle}>{tm.memberCount}</td>
                    {METRIC_ORDER.map((m) => {
                      const mv = byMetric.get(m);
                      return (
                        <td key={m} style={tdMutedStyle}>
                          {fmtMetric(m, mv?.value ?? null)}
                          {mv?.percentile != null && (
                            <span style={{ color: percentileColor(mv.percentile), fontWeight: 700, marginLeft: 6, fontSize: '0.74rem' }}>
                              {mv.percentile}%
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ ...tdStyle, color: percentileColor(tm.overallPercentile), fontWeight: 700 }}>
                      {tm.overallPercentile != null ? `${tm.overallPercentile}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PmCard>
    </div>
  );
}
