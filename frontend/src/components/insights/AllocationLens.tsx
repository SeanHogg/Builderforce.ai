'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import {
  insightsApi,
  type AllocationInsights, type AllocationGoal, type AllocationCategory, type CategoryAllocation,
  type AllocationHistory, type CapitalizationStatus, type EpicCapitalization,
} from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard, ProgressBar } from '@/components/pm/pmShared';
import { DonutChart } from '@/components/charts/DonutChart';
import { COST_CLASS_COLORS, formatUsd } from '@/lib/pm/costClass';
import { Select } from '@/components/Select';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { KpiGrid } from './LensShell';
import { usd, pct, hrs } from './format';

const ALL_CATEGORIES: AllocationCategory[] = ['innovation', 'ktlo', 'support', 'tech_debt', 'other'];
const CAP_STATUSES: CapitalizationStatus[] = ['capitalized', 'not_capitalized', 'uncategorized'];

const CATEGORY_TONE: Record<AllocationCategory, string> = {
  innovation: '#2563eb', ktlo: '#16a34a', support: '#d97706', tech_debt: '#9333ea', other: '#9ca3af',
};
/** Capitalization slice tones — reuse the canonical CAPEX/OPEX tokens. */
const STATUS_TONE: Record<CapitalizationStatus, string> = {
  capitalized: COST_CLASS_COLORS.capex,
  not_capitalized: COST_CLASS_COLORS.opex,
  uncategorized: '#9ca3af',
};

const inputStyle: CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};
const btnStyle: CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
};

const fte = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A compact two-option segmented control (FTE | Cost). */
function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map((o) => (
        <button
          key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          style={{
            padding: '5px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', border: 'none',
            background: value === o.value ? 'var(--accent, #2563eb)' : 'transparent',
            color: value === o.value ? '#fff' : 'var(--text-secondary)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A thin value bar relative to a max (the cost-report FTE-month bars). */
function MiniBar({ frac, color }: { frac: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden', marginTop: 4, minWidth: 80 }}>
      <div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, height: '100%', background: color }} />
    </div>
  );
}

function StatusPill({ status, label }: { status: CapitalizationStatus; label: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, color: '#fff', background: STATUS_TONE[status], whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
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
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [metric, setMetric] = useState<'fte' | 'cost'>('fte');
  const [epicFilter, setEpicFilter] = useState<'all' | CapitalizationStatus>('all');

  useEffect(() => { let alive = true; fetchProjects().then((p) => { if (alive) setProjects(p); }).catch(() => {}); return () => { alive = false; }; }, []);

  const { data, error, reload } = usePmData<AllocationInsights>(() => insightsApi.allocation({ days, period, projectId }), [days, period, projectId]);
  const { data: goals, reload: reloadGoals } = usePmData<AllocationGoal[]>(() => insightsApi.allocationGoals.list(), []);
  const { data: history } = usePmData<AllocationHistory>(() => insightsApi.allocationHistory({ months: 12, projectId }), [projectId]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reload(); reloadGoals(); } finally { setBusy(false); }
  };

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const catLabel = (c: AllocationCategory) => t(`alloc.cat.${c}`);
  const statusLabel = (s: CapitalizationStatus) => t(`alloc.status.${s}`);
  // Goals for the active scope (tenant, or the selected project) + period.
  const goalScope = projectId != null ? 'project' : 'tenant';
  const periodGoals = (goals ?? []).filter((g) => g.scopeKind === goalScope && g.periodMonth === period && (goalScope === 'tenant' || g.projectId === projectId));

  // ── Capitalization donut (FTE | Cost) ──
  const statusVal = (s: CapitalizationStatus) => metric === 'fte' ? data.totals.byStatus[s].fteMonths : data.totals.byStatus[s].costUsd;
  const statusSegments = CAP_STATUSES.map((s) => ({ key: s, label: statusLabel(s), value: statusVal(s), color: STATUS_TONE[s] }));
  const statusTotal = CAP_STATUSES.reduce((sum, s) => sum + statusVal(s), 0);
  const fmtMetric = (v: number) => metric === 'fte' ? fte(v) : formatUsd(v);

  // ── Investment-mix donut (effort by category) ──
  const mixRows = data.byCategory.filter((b) => b.hours > 0);
  const mixSegments = mixRows.map((b) => ({ key: b.category, label: catLabel(b.category), value: b.hours, color: CATEGORY_TONE[b.category] }));

  // ── Epic browser ──
  const epicCounts: Record<'all' | CapitalizationStatus, number> = {
    all: data.epics.length,
    capitalized: data.epics.filter((e) => e.status === 'capitalized').length,
    not_capitalized: data.epics.filter((e) => e.status === 'not_capitalized').length,
    uncategorized: data.epics.filter((e) => e.status === 'uncategorized').length,
  };
  const visibleEpics = epicFilter === 'all' ? data.epics : data.epics.filter((e) => e.status === epicFilter);
  const maxEpicFte = Math.max(1e-9, ...data.epics.map((e) => e.fteMonths));
  const maxHistFte = Math.max(1e-9, ...(history?.months ?? []).map((m) => m.capitalizedFteMonths));

  const tabBtn = (active: boolean): CSSProperties => ({
    padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: 600,
    background: active ? 'var(--accent, #2563eb)' : 'transparent',
    color: active ? '#fff' : 'var(--text-secondary)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Select style={{ ...inputStyle, maxWidth: 200 }} value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : undefined)} aria-label={t('alloc.scope')}>
          <option value="">{t('alloc.allProjects')}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
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

      {/* Donuts — capitalization split (FTE|Cost) + investment mix */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        <PmCard
          title={t('alloc.capTitle')}
          action={<Segmented value={metric} onChange={setMetric} options={[{ value: 'fte', label: t('alloc.fte') }, { value: 'cost', label: t('alloc.cost') }]} />}
        >
          {statusTotal <= 0 ? (
            <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('alloc.noData')}</span>
          ) : (
            <DonutChart
              segments={statusSegments}
              centerLabel={metric === 'fte' ? t('alloc.fteMonths') : t('alloc.cost')}
              centerValue={metric === 'fte' ? fte(statusTotal) : formatUsd(statusTotal)}
              formatValue={fmtMetric}
              ariaLabel={t('alloc.capTitle')}
            />
          )}
        </PmCard>

        <PmCard title={t('alloc.mix')}>
          {data.totals.hours === 0 ? (
            <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('alloc.noData')}</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <DonutChart
                segments={mixSegments}
                centerLabel={t('alloc.fteMonths')}
                centerValue={fte(data.totals.byStatus.capitalized.fteMonths + data.totals.byStatus.not_capitalized.fteMonths + data.totals.byStatus.uncategorized.fteMonths)}
                formatValue={(v) => hrs(v)}
                ariaLabel={t('alloc.mix')}
              />
              {/* Goal variance retained per category (EMP-2) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {mixRows.map((b: CategoryAllocation) => (
                  <div key={b.category} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.82rem' }}>
                      <span style={{ fontWeight: 600, color: CATEGORY_TONE[b.category] }}>{catLabel(b.category)}</span>
                      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontWeight: 700 }}>{pct(b.pct)}</span>
                        {b.targetPct != null && <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{t('alloc.target', { n: b.targetPct.toFixed(0) })}</span>}
                        <Variance v={b.variancePct} />
                      </span>
                    </div>
                    <ProgressBar value={b.pct / 100} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </PmCard>
      </div>

      {/* Historical months — capitalized FTE-months + cost trend */}
      <PmCard title={t('alloc.historyTitle')} action={history ? <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t('alloc.dataAsOf', { d: new Date(history.dataAsOf).toLocaleString() })}</span> : undefined}>
        {!history ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('loading')}</span>
        ) : history.months.every((m) => m.taskCount === 0) ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('alloc.noData')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('alloc.month')}</th>
                  <th style={thStyle}>{t('alloc.statusCol')}</th>
                  <th style={thStyle}>{t('alloc.capFteMonths')}</th>
                  <th style={thStyle}>{t('alloc.capCost')}</th>
                  <th style={thStyle}>{t('alloc.totalCost')}</th>
                </tr>
              </thead>
              <tbody>
                {history.months.map((m) => (
                  <tr key={m.month} style={trStyle}>
                    <td style={tdStyle}>{m.month}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: '0.76rem', fontWeight: 600, color: m.status === 'in_progress' ? '#d97706' : '#16a34a' }}>
                        {m.status === 'in_progress' ? t('alloc.inProgress') : t('alloc.ready')}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600 }}>{fte(m.capitalizedFteMonths)}</span>
                      <MiniBar frac={m.capitalizedFteMonths / maxHistFte} color={STATUS_TONE.capitalized} />
                    </td>
                    <td style={tdMutedStyle}>{usd(m.capitalizedUsd)}</td>
                    <td style={tdMutedStyle}>{usd(m.totalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>

      {/* Epic capitalization browser */}
      <PmCard
        title={t('alloc.epicsTitle', { n: data.epics.length })}
        action={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['all', 'capitalized', 'not_capitalized', 'uncategorized'] as const).map((f) => (
              <button key={f} type="button" style={tabBtn(epicFilter === f)} onClick={() => setEpicFilter(f)}>
                {f === 'all' ? t('alloc.allEpics') : statusLabel(f)} {epicCounts[f]}
              </button>
            ))}
          </div>
        }
      >
        {data.epics.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('alloc.noEpics')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('alloc.epic')}</th>
                  <th style={thStyle}>{t('alloc.statusCol')}</th>
                  <th style={thStyle}>{t('alloc.fteMonths')}</th>
                  <th style={thStyle}>{t('alloc.cost')}</th>
                  <th style={thStyle}>{t('alloc.project')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleEpics.map((e: EpicCapitalization) => (
                  <tr key={e.epicId} style={trStyle}>
                    <td style={tdStyle}>
                      <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>#{e.epicId}</span>{e.title}
                    </td>
                    <td style={tdStyle}><StatusPill status={e.status} label={statusLabel(e.status)} /></td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600 }}>{fte(e.fteMonths)}</span>
                      <MiniBar frac={e.fteMonths / maxEpicFte} color={STATUS_TONE[e.status]} />
                    </td>
                    <td style={tdMutedStyle}>{formatUsd(e.costUsd)}</td>
                    <td style={tdMutedStyle}>{e.projectName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                await insightsApi.allocationGoals.create({ scopeKind: goalScope, projectId, periodMonth: period, category: goalCat, targetPct: Number(goalPct) });
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
