'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type FinanceInsights, type FinanceBudgetLine, type BudgetState } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard, ProgressBar } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { KpiGrid } from './LensShell';
import { usd } from './format';

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};
const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
};

const STATUS_TONE: Record<BudgetState, string> = {
  over: 'var(--danger, #dc2626)', forecast_over: '#d97706', on_track: '#16a34a', no_budget: 'var(--text-muted)',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function FinanceLens() {
  const t = useTranslations('insights');
  const [period, setPeriod] = useState(currentMonth());
  const [busy, setBusy] = useState(false);
  const [newLimit, setNewLimit] = useState('');
  const { data, error, reload } = usePmData<FinanceInsights>(() => insightsApi.finance(period), [period]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reload(); } finally { setBusy(false); }
  };

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const statusLabel = (s: BudgetState) => t(`fin.status.${s}`);
  const lineProgress = (b: FinanceBudgetLine) => (b.limitUsd > 0 ? b.actualUsd / b.limitUsd : 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <input type="month" style={inputStyle} value={period} onChange={(e) => setPeriod(e.target.value || currentMonth())} aria-label={t('fin.period')} />
      </div>

      <KpiGrid>
        <StatCard label={t('fin.spend')} value={usd(data.totals.spendUsd)} sub={data.periodMonth} />
        <StatCard label={t('fin.forecast')} value={usd(data.totals.forecastUsd)} sub={t('fin.forecastSub')} />
        <StatCard label={t('fin.costPerPr')} value={usd(data.totals.costPerMergedPrUsd)} sub={t('fin.mergedRuns', { n: data.totals.mergedRuns })} />
        <StatCard label={t('fin.paidOverflow')} value={usd(data.totals.paidOverflowUsd)} sub={t('fin.paidOverflowSub')} />
        <StatCard label={t('fin.cacheRead')} value={data.totals.cacheReadTokens.toLocaleString()} sub={t('fin.cacheReadSub')} />
      </KpiGrid>

      <PmCard
        title={t('fin.budgets')}
        action={
          <div style={{ display: 'flex', gap: 8, minWidth: 280 }}>
            <input style={{ ...inputStyle, width: 130 }} type="number" min={0} placeholder={t('fin.monthlyLimit')} value={newLimit} onChange={(e) => setNewLimit(e.target.value)} />
            <button
              type="button" style={btnStyle} disabled={busy || !newLimit.trim()}
              onClick={() => run(async () => {
                await insightsApi.budgets.create({ scopeKind: 'tenant', periodMonth: period, limitUsd: Number(newLimit) });
                setNewLimit('');
              })}
            >
              {t('fin.setBudget')}
            </button>
          </div>
        }
      >
        {data.budgets.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('fin.noBudgets')}</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.budgets.map((b) => (
              <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 600 }}>{b.scopeName}</span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{usd(b.actualUsd)} / {usd(b.limitUsd)}</span>
                    <span style={{ color: STATUS_TONE[b.status], fontWeight: 600, fontSize: '0.78rem' }}>{statusLabel(b.status)}</span>
                    <button
                      type="button" disabled={busy} title={t('common.delete')}
                      onClick={() => run(() => insightsApi.budgets.remove(b.id))}
                      style={{ ...btnStyle, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', padding: '3px 8px' }}
                    >
                      ×
                    </button>
                  </span>
                </div>
                <ProgressBar value={lineProgress(b)} />
              </div>
            ))}
          </div>
        )}
      </PmCard>

      <PmCard title={t('fin.byProject')}>
        {data.byProject.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('fin.noSpend')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead><tr style={theadRowStyle}><th style={thStyle}>{t('fin.project')}</th><th style={thStyle}>{t('fin.spend')}</th></tr></thead>
              <tbody>
                {data.byProject.map((p) => (
                  <tr key={p.projectId} style={trStyle}>
                    <td style={tdStyle}>{p.projectName}</td>
                    <td style={tdMutedStyle}>{usd(p.usd)}</td>
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
