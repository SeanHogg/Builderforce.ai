'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type AllocationInsights, type AllocationGoal, type AllocationCategory, type CategoryAllocation } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard, ProgressBar } from '@/components/pm/pmShared';
import { Select } from '@/components/Select';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { KpiGrid } from './LensShell';
import { usd, pct, hrs } from './format';

const ALL_CATEGORIES: AllocationCategory[] = ['innovation', 'ktlo', 'support', 'tech_debt', 'other'];

const CATEGORY_TONE: Record<AllocationCategory, string> = {
  innovation: '#2563eb', ktlo: '#16a34a', support: '#d97706', tech_debt: '#9333ea', other: 'var(--text-muted)',
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};
const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Signed variance (actual − target) rendered with tone + sign. */
function Variance({ v }: { v: number | undefined }) {
  const t = useTranslations('insights');
  if (v == null) return <span style={{ color: 'var(--text-muted)' }}>{t('alloc.noGoal')}</span>;
  const tone = Math.abs(v) < 5 ? '#16a34a' : v < 0 ? 'var(--danger, #dc2626)' : '#d97706';
  return <span style={{ color: tone, fontWeight: 600 }}>{v >= 0 ? '+' : ''}{v.toFixed(0)}%</span>;
}

export function AllocationLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const [period, setPeriod] = useState(currentMonth());
  const [busy, setBusy] = useState(false);
  const [goalCat, setGoalCat] = useState<AllocationCategory>('innovation');
  const [goalPct, setGoalPct] = useState('');

  const { data, error, reload } = usePmData<AllocationInsights>(() => insightsApi.allocation({ days, period }), [days, period]);
  const { data: goals, reload: reloadGoals } = usePmData<AllocationGoal[]>(() => insightsApi.allocationGoals.list(), []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reload(); reloadGoals(); } finally { setBusy(false); }
  };

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const catLabel = (c: AllocationCategory) => t(`alloc.cat.${c}`);
  // Goals for the active tenant scope + period (the lens shows tenant grain).
  const periodGoals = (goals ?? []).filter((g) => g.scopeKind === 'tenant' && g.periodMonth === period);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Select style={inputStyle} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('window')}>
          <option value={7}>{t('days', { n: 7 })}</option>
          <option value={30}>{t('days', { n: 30 })}</option>
          <option value={90}>{t('days', { n: 90 })}</option>
        </Select>
        <input type="month" style={inputStyle} value={period} onChange={(e) => setPeriod(e.target.value || currentMonth())} aria-label={t('alloc.period')} />
      </div>

      <KpiGrid>
        <StatCard label={t('alloc.totalHours')} value={hrs(data.totals.hours)} sub={t('alloc.totalHoursSub', { n: data.totals.taskCount })} />
        <StatCard label={t('alloc.capitalizable')} value={pct(data.totals.capitalizablePct)} sub={t('alloc.capitalizableSub')} />
        <StatCard label={t('alloc.capex')} value={usd(data.totals.capexUsd)} sub={t('alloc.capexSub')} />
        <StatCard label={t('alloc.opex')} value={usd(data.totals.opexUsd)} sub={t('alloc.opexSub')} />
      </KpiGrid>

      {/* Investment mix — effort-in-time per category, with goal variance (EMP-1/EMP-2) */}
      <PmCard title={t('alloc.mix')}>
        {data.totals.hours === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('alloc.noData')}</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.byCategory.filter((b) => b.hours > 0).map((b: CategoryAllocation) => (
              <div key={b.category} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 600, color: CATEGORY_TONE[b.category] }}>{catLabel(b.category)}</span>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{hrs(b.hours)} · {b.taskCount}</span>
                    <span style={{ fontWeight: 700 }}>{pct(b.pct)}</span>
                    {b.targetPct != null && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{t('alloc.target', { n: b.targetPct.toFixed(0) })}</span>}
                    <Variance v={b.variancePct} />
                  </span>
                </div>
                <ProgressBar value={b.pct / 100} />
              </div>
            ))}
          </div>
        )}
      </PmCard>

      {/* Allocation goals (EMP-2) — set desired investment mix per category */}
      <PmCard
        title={t('alloc.goals')}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Select style={{ ...inputStyle, width: 150 }} value={goalCat} onChange={(e) => setGoalCat(e.target.value as AllocationCategory)} aria-label={t('alloc.category')}>
              {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </Select>
            <input style={{ ...inputStyle, width: 90 }} type="number" min={0} max={100} placeholder={t('alloc.targetPct')} value={goalPct} onChange={(e) => setGoalPct(e.target.value)} />
            <button
              type="button" style={btnStyle} disabled={busy || !goalPct.trim()}
              onClick={() => run(async () => {
                await insightsApi.allocationGoals.create({ scopeKind: 'tenant', periodMonth: period, category: goalCat, targetPct: Number(goalPct) });
                setGoalPct('');
              })}
            >
              {t('alloc.setGoal')}
            </button>
          </div>
        }
      >
        {periodGoals.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('alloc.noGoals')}</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {periodGoals.map((g) => (
              <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                <span style={{ fontWeight: 600, color: CATEGORY_TONE[g.category] }}>{catLabel(g.category)}</span>
                <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t('alloc.target', { n: g.targetPct.toFixed(0) })}</span>
                  <button
                    type="button" disabled={busy} title={t('common.delete')}
                    onClick={() => run(() => insightsApi.allocationGoals.remove(g.id))}
                    style={{ ...btnStyle, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', padding: '3px 8px' }}
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </PmCard>

      {/* Per-member allocation — individual grain + investment spread (EMP-1/EMP-12) */}
      <PmCard title={t('alloc.byMember')}>
        {data.byMember.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('alloc.noMembers')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('alloc.member')}</th>
                  <th style={thStyle}>{t('alloc.hours')}</th>
                  <th style={thStyle}>{t('alloc.topCategory')}</th>
                  <th style={thStyle}>{t('alloc.spread')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byMember.map((m) => (
                  <tr key={`${m.memberKind}:${m.memberRef}`} style={trStyle}>
                    <td style={tdStyle}>{m.memberName}</td>
                    <td style={tdMutedStyle}>{hrs(m.totalHours)}</td>
                    <td style={tdStyle}>
                      {m.byCategory[0] ? (
                        <span style={{ color: CATEGORY_TONE[m.byCategory[0].category] }}>
                          {catLabel(m.byCategory[0].category)} · {pct(m.byCategory[0].pct)}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={tdMutedStyle}>{m.categorySpread}</td>
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
