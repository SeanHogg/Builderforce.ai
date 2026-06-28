'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { devexApi, type DevexInsights } from '@/lib/devexApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { pct, score2, int } from './format';

/**
 * DevEx Surveys & Insights lens (gate insights.devex) — the rollup behind the
 * "DevEx Surveys & Insights" and "AI DevEx Analysis" features: response rate,
 * eNPS, the AI-tools sentiment cut, per-dimension scores, and the trend.
 */
export function DevexLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(90);
  const { data, error } = usePmData<DevexInsights>(() => devexApi.insights(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const score100 = (n: number) => `${score2(n)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      <KpiGrid>
        <StatCard label={t('devex.responseRate')} value={pct(data.responseRatePct)} sub={t('devex.responseRateSub')} />
        <StatCard label={t('devex.responses')} value={int(data.totalResponses)} sub={t('days', { n: data.windowDays })} />
        <StatCard label={t('devex.enps')} value={score2(data.enps)} sub={t('devex.enpsSub')} />
        <StatCard label={t('devex.aiScore')} value={score100(data.aiToolsSentiment.avgScore)} sub={t('devex.aiScoreSub')} />
        <StatCard label={t('devex.aiPositive')} value={pct(data.aiToolsSentiment.positivePct)} sub={t('devex.aiPositiveSub', { n: data.aiToolsSentiment.n })} />
      </KpiGrid>

      <PmCard title={t('devex.byDimension')}>
        {data.byDimension.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('devex.noData')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('devex.dimension')}</th>
                  <th style={thStyle}>{t('devex.avgScore')}</th>
                  <th style={thStyle}>{t('devex.datapoints')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byDimension.map((d) => (
                  <tr key={d.dimension} style={trStyle}>
                    <td style={tdStyle}>{t(`devex.dim.${d.dimension}`)}</td>
                    <td style={tdMutedStyle}>{score100(d.avgScore)}</td>
                    <td style={tdMutedStyle}>{int(d.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>

      <PmCard title={t('devex.trend')}>
        {data.trend.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('devex.noTrend')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('devex.period')}</th>
                  <th style={thStyle}>{t('devex.avgScore')}</th>
                  <th style={thStyle}>{t('devex.enps')}</th>
                  <th style={thStyle}>{t('devex.responses')}</th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map((p) => (
                  <tr key={p.periodMonth} style={trStyle}>
                    <td style={tdStyle}>{p.periodMonth}</td>
                    <td style={tdMutedStyle}>{score100(p.avgScore)}</td>
                    <td style={tdMutedStyle}>{score2(p.enps)}</td>
                    <td style={tdMutedStyle}>{int(p.responses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>
    </div>
  );
}
