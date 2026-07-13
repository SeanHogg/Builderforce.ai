'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type EngineeringInsights, type EffectivenessBucket } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { usd, pct, score2 } from './format';

/**
 * LENS #1 — AI effectiveness over run_model_outcomes. The "which approach
 * actually ships" ranking (action_type × model) that exists nowhere else.
 */
export function EngineeringLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const { data, error } = usePmData<EngineeringInsights>(() => insightsApi.engineering(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const table = (title: string, label: string, rows: EffectivenessBucket[]) => (
    <PmCard title={title}>
      {rows.length === 0 ? (
        <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('eng.noRuns')}</span>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{label}</th>
                <th style={thStyle}>{t('eng.runs')}</th>
                <th style={thStyle}>{t('eng.score')}</th>
                <th style={thStyle}>{t('eng.mergeRate')}</th>
                <th style={thStyle}>{t('eng.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key} style={trStyle}>
                  <td style={tdStyle}>{b.key}</td>
                  <td style={tdMutedStyle}>{b.runs}</td>
                  <td style={tdMutedStyle}>{score2(b.avgScore)}</td>
                  <td style={tdMutedStyle}>{pct(b.mergedRatePct)}</td>
                  <td style={tdMutedStyle}>{usd(b.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PmCard>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><DaysWindowSelect value={days} onChange={setDays} /></div>
      <KpiGrid>
        <StatCard label={t('eng.runs')} value={String(data.totals.runs)} sub={t('days', { n: data.windowDays })} />
        <StatCard label={t('eng.avgScore')} value={score2(data.totals.avgScore)} sub={t('eng.scoreSub')} />
        <StatCard label={t('eng.mergeRate')} value={pct(data.totals.mergedRatePct)} sub={t('eng.mergeSub')} />
        <StatCard label={t('eng.ciGreen')} value={pct(data.totals.ciGreenRatePct)} sub={t('eng.ciSub')} />
        <StatCard label={t('eng.degraded')} value={pct(data.totals.degradedRatePct)} sub={t('eng.degradedSub')} />
        <StatCard label={t('eng.cost')} value={usd(data.totals.costUsd)} sub={t('eng.costSub')} />
      </KpiGrid>
      {table(t('eng.byApproach'), t('eng.approach'), data.byApproach)}
      {table(t('eng.byModel'), t('eng.model'), data.byModel)}
      {table(t('eng.byActionType'), t('eng.workType'), data.byActionType)}
    </div>
  );
}
