'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { aiImpactApi, type AiImpactInsights } from '@/lib/aiImpactApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { usd, pct, score2, int } from './format';

/**
 * LENS — "AI Impact": adoption & usage trends, a multi-tool evaluation matrix,
 * and a composite AI productivity score. Reads existing collectors only
 * (llm_usage_log + run_model_outcomes).
 */
export function AiImpactLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const { data, error } = usePmData<AiImpactInsights>(() => aiImpactApi.get(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const p = data.productivity;
  const deltaSub = `${p.deltaPct >= 0 ? '+' : ''}${p.deltaPct.toFixed(0)}% ${t('aiImpact.wow')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      {/* AI Productivity Insights — composite score + components */}
      <KpiGrid>
        <StatCard label={t('aiImpact.productivityScore')} value={score2(p.score)} sub={deltaSub} />
        <StatCard label={t('aiImpact.throughput')} value={pct(p.throughput * 100)} sub={t('aiImpact.throughputSub')} />
        <StatCard label={t('aiImpact.quality')} value={pct(p.quality * 100)} sub={t('aiImpact.qualitySub')} />
        <StatCard label={t('aiImpact.efficiency')} value={pct(p.efficiency * 100)} sub={t('aiImpact.efficiencySub')} />
        <StatCard label={t('aiImpact.prevScore')} value={score2(p.prevScore)} sub={t('aiImpact.prevSub')} />
      </KpiGrid>

      {/* Multi-Tool Evaluation — head-to-head comparison matrix */}
      <PmCard title={t('aiImpact.comparisonTitle')}>
        {data.comparison.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('aiImpact.noRuns')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('aiImpact.model')}</th>
                  <th style={thStyle}>{t('aiImpact.runs')}</th>
                  <th style={thStyle}>{t('aiImpact.avgScore')}</th>
                  <th style={thStyle}>{t('aiImpact.mergeRate')}</th>
                  <th style={thStyle}>{t('aiImpact.ciGreen')}</th>
                  <th style={thStyle}>{t('aiImpact.avgSteps')}</th>
                  <th style={thStyle}>{t('aiImpact.costPerMergedPr')}</th>
                  <th style={thStyle}>{t('aiImpact.tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {data.comparison.map((r) => (
                  <tr key={r.model} style={trStyle}>
                    <td style={tdStyle}>{r.model}</td>
                    <td style={tdMutedStyle}>{int(r.runs)}</td>
                    <td style={tdMutedStyle}>{score2(r.avgScore)}</td>
                    <td style={tdMutedStyle}>{pct(r.mergedRatePct)}</td>
                    <td style={tdMutedStyle}>{pct(r.ciGreenRatePct)}</td>
                    <td style={tdMutedStyle}>{r.avgSteps.toFixed(1)}</td>
                    <td style={tdMutedStyle}>{usd(r.costPerMergedPrUsd)}</td>
                    <td style={tdMutedStyle}>{int(r.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>

      {/* Adoption & Usage Trends — model share trend */}
      <PmCard title={t('aiImpact.shareTrendTitle')}>
        {data.adoption.modelShareTrend.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('aiImpact.noUsage')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('aiImpact.model')}</th>
                  <th style={thStyle}>{t('aiImpact.currentShare')}</th>
                  <th style={thStyle}>{t('aiImpact.shareDelta')}</th>
                </tr>
              </thead>
              <tbody>
                {data.adoption.modelShareTrend.map((r) => (
                  <tr key={r.model} style={trStyle}>
                    <td style={tdStyle}>{r.model}</td>
                    <td style={tdMutedStyle}>{pct(r.currentSharePct)}</td>
                    <td style={tdMutedStyle}>{`${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct.toFixed(0)} pp`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>

      {/* Adoption & Usage Trends — weekly buckets */}
      <PmCard title={t('aiImpact.weeklyTitle')}>
        {data.adoption.weekly.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('aiImpact.noUsage')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('aiImpact.weekStart')}</th>
                  <th style={thStyle}>{t('aiImpact.activeUsers')}</th>
                  <th style={thStyle}>{t('aiImpact.runs')}</th>
                  <th style={thStyle}>{t('aiImpact.tokens')}</th>
                  <th style={thStyle}>{t('aiImpact.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {data.adoption.weekly.map((w) => (
                  <tr key={w.weekStart} style={trStyle}>
                    <td style={tdStyle}>{w.weekStart}</td>
                    <td style={tdMutedStyle}>{int(w.activeUsers)}</td>
                    <td style={tdMutedStyle}>{int(w.runs)}</td>
                    <td style={tdMutedStyle}>{int(w.tokens)}</td>
                    <td style={tdMutedStyle}>{usd(w.costUsd)}</td>
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
