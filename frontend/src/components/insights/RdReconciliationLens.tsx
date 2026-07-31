'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { rdReconciliationApi, type RdReconciliation, type ReconFlag } from '@/lib/rdReconciliationApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { Select } from '@/components/Select';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

const usd = (v: number | null | undefined): string =>
  v == null ? '—' : `$${Math.round(v).toLocaleString()}`;

const FLAG_COLOR: Record<ReconFlag, { bg: string; fg: string }> = {
  aligned: { bg: 'rgba(16,185,129,0.16)', fg: '#059669' },
  derived_higher: { bg: 'rgba(245,158,11,0.16)', fg: '#b45309' },
  reported_higher: { bg: 'rgba(245,158,11,0.16)', fg: '#b45309' },
  no_reported: { bg: 'rgba(148,163,184,0.16)', fg: 'var(--text-muted)' },
};

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};

/**
 * PANEL — R&D reconciliation. Puts the DERIVED QRE credit base (from allocation
 * effort + LLM spend) side-by-side with the REPORTED manual quarterly R&D facts,
 * flagging the variance so the two surfaces cross-check instead of diverging.
 */
export function RdReconciliationLens() {
  const t = useTranslations('insights.emp');
  const thisYear = new Date().getUTCFullYear();
  const [fy, setFy] = useState(thisYear);
  const { data, error } = usePmData<RdReconciliation>(() => rdReconciliationApi.get(fy), [fy]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const flag = data.variance.flag;
  const flagColor = FLAG_COLOR[flag];
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          {t('recon.fiscalYear')}
          <Select style={selectStyle} value={String(fy)} onChange={(e) => setFy(Number(e.target.value))} aria-label={t('recon.fiscalYear')}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 999, background: flagColor.bg, color: flagColor.fg, fontSize: '0.8rem', fontWeight: 700 }}>
          {t(`recon.flag.${flag}`)}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          {t('recon.variance')}: {usd(data.variance.absUsd)}
          {data.variance.pct != null && ` (${data.variance.pct > 0 ? '+' : ''}${data.variance.pct.toFixed(0)}%)`}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <StatCard label={t('recon.derivedBase')} value={usd(data.derived.baseUsd)} sub={t('recon.derivedSub')} />
        <StatCard label={t('recon.reportedActual')} value={usd(data.reported.actualUsd)} sub={t('recon.reportedSub')} />
        <StatCard label={t('recon.derivedLabor')} value={usd(data.derived.laborUsd)} sub={`${Math.round(data.derived.qualifiedHours).toLocaleString()}h · $${data.derived.blendedRate}/h`} />
        <StatCard label={t('recon.derivedAiSpend')} value={usd(data.derived.aiSpendUsd)} />
        <StatCard label={t('recon.reportedPlan')} value={usd(data.reported.planUsd)} />
        <StatCard label={t('recon.rdToRevenue')} value={data.reported.rdToRevenuePct == null ? '—' : `${data.reported.rdToRevenuePct.toFixed(0)}%`} />
      </div>

      {data.quarters.length > 0 && (
        <PmCard title={t('recon.quartersTitle')}>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('recon.quarter')}</th>
                  <th style={thStyle}>{t('recon.reportedActual')}</th>
                  <th style={thStyle}>{t('recon.reportedPlan')}</th>
                  <th style={thStyle}>{t('recon.revenue')}</th>
                  <th style={thStyle}>{t('recon.rdToRevenue')}</th>
                </tr>
              </thead>
              <tbody>
                {data.quarters.map((q) => (
                  <tr key={q.quarter} style={trStyle}>
                    <td style={tdStyle}>Q{q.quarter}</td>
                    <td style={tdMutedStyle}>{usd(q.totalActualUsd)}</td>
                    <td style={tdMutedStyle}>{usd(q.totalPlanUsd)}</td>
                    <td style={tdMutedStyle}>{usd(q.revenueUsd)}</td>
                    <td style={tdMutedStyle}>{q.rdToRevenuePct == null ? '—' : `${q.rdToRevenuePct.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 12 }}>{t('recon.footnote')}</p>
        </PmCard>
      )}
    </div>
  );
}
