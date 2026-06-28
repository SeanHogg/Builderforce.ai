'use client';

/**
 * Finance/FinOps lens + the AI-Effectiveness "Engineering" lens, decomposed into
 * individually-pinnable widgets.
 *
 * The Finance hub's FinanceLens (spend, forecast, cost-per-PR, paid overflow,
 * cache reads, spend-over-time, budgets, spend-by-project) and the Engineering
 * effectiveness lens (outcome score, merge rate, CI-green, degraded rate,
 * cost-per-merged work, the approach/model/action-type rankings) are each now a
 * standalone {@link WidgetDef} so a user can pin the exact tile they want onto
 * their dashboard. Every card reads the SAME collector through a shared, deduped
 * source (one request per source+window via {@link useSharedSource}), renders
 * only its body (the WidgetCard chrome supplies frame + title + pin), and drills
 * back into the matching slide-out lens.
 *
 * Mirrors aiImpactWidgets.tsx exactly.
 */

import { useTranslations } from 'next-intl';
import {
  insightsApi,
  type FinanceInsights,
  type EngineeringInsights,
  type EffectivenessBucket,
} from '@/lib/builderforceApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { BarChart } from '@/components/charts/BarChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { usd, pct, score2, int } from '../format';

// ── Shared, deduped sources (one request per source+window) ────────────────────

/** Current calendar month, the FinanceLens default period. */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** One shared, deduped read of the finance collector for the current month. */
function useFinance() {
  const period = currentMonth();
  return useSharedSource<FinanceInsights>(`finance:${period}`, () => insightsApi.finance(period));
}

/** One shared, deduped read of the engineering-effectiveness collector per window. */
function useEngineering(days: number) {
  return useSharedSource<EngineeringInsights>(`engineering:${days}`, () => insightsApi.engineering(days));
}

const FIN_DRILL: WidgetDrill = { kind: 'panel', hub: 'finance', panel: 'finance' };
const ENG_DRILL: WidgetDrill = { kind: 'panel', hub: 'ai', panel: 'engineering' };
const FIN_CAP = 'insights.finance' as const;
const ENG_CAP = 'insights.engineering' as const;

// ── Small presentational bodies (the WidgetCard owns the frame/title/pin) ──────

function Stat({ value, sub }: { value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{children}</span>;
}

/** Wrap a finance card body: handles loading / error so each widget needn't repeat it. */
function useFin() {
  const t = useTranslations('insights');
  const { data, error } = useFinance();
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

/** Wrap an engineering card body: handles loading / error. */
function useEng(days: number) {
  const t = useTranslations('insights');
  const { data, error } = useEngineering(days);
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

// ── Finance widget bodies ──────────────────────────────────────────────────────

function SpendCard(_: WidgetCardProps) {
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={usd(data.totals.spendUsd)} sub={data.periodMonth} />;
}

function ForecastCard(_: WidgetCardProps) {
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={usd(data.totals.forecastUsd)} sub={t('fin.forecastSub')} />;
}

function CostPerPrCard(_: WidgetCardProps) {
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={usd(data.totals.costPerMergedPrUsd)} sub={t('fin.mergedRuns', { n: data.totals.mergedRuns })} />;
}

function PaidOverflowCard(_: WidgetCardProps) {
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={usd(data.totals.paidOverflowUsd)} sub={t('fin.paidOverflowSub')} />;
}

function CacheReadCard(_: WidgetCardProps) {
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={int(data.totals.cacheReadTokens)} sub={t('fin.cacheReadSub')} />;
}

function SpendTrendCard(_: WidgetCardProps) {
  const { data, state, t } = useFin();
  if (!data) return state;
  if (data.daily.length === 0 || data.daily.every((d) => d.usd === 0)) return <Muted>{t('fin.noSpend')}</Muted>;
  return (
    <TrendChart
      labels={data.daily.map((d) => d.date.slice(5))}
      series={[{ key: 'spend', label: t('fin.spend'), values: data.daily.map((d) => d.usd) }]}
      area
      formatValue={(v) => usd(v)}
      ariaLabel={t('fin.spendOverTime')}
    />
  );
}

function BudgetVarianceCard(_: WidgetCardProps) {
  const { data, state, t } = useFin();
  if (!data) return state;
  if (data.budgets.length === 0) return <Muted>{t('fin.noBudgets')}</Muted>;
  return (
    <BarChart
      data={data.budgets.map((b, i) => ({
        key: b.id,
        label: b.scopeName,
        value: b.actualUsd,
        secondary: b.limitUsd,
        color: colorAt(i),
      }))}
      formatValue={(v) => usd(v)}
      maxRows={8}
      labelWidth={140}
      ariaLabel={t('fin.budgets')}
    />
  );
}

function ByProjectCard(_: WidgetCardProps) {
  const { data, state, t } = useFin();
  if (!data) return state;
  if (data.byProject.length === 0) return <Muted>{t('fin.noSpend')}</Muted>;
  return (
    <BarChart
      data={data.byProject.map((p) => ({ key: String(p.projectId), label: p.projectName, value: p.usd }))}
      formatValue={(v) => usd(v)}
      maxRows={8}
      labelWidth={140}
      ariaLabel={t('fin.byProject')}
    />
  );
}

// ── Engineering widget bodies ──────────────────────────────────────────────────

function OutcomeScoreCard({ days }: WidgetCardProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={score2(data.totals.avgScore)} sub={t('eng.scoreSub')} />;
}

function MergeRateCard({ days }: WidgetCardProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={pct(data.totals.mergedRatePct)} sub={t('eng.mergeSub')} />;
}

function CiGreenCard({ days }: WidgetCardProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={pct(data.totals.ciGreenRatePct)} sub={t('eng.ciSub')} />;
}

function DegradedCard({ days }: WidgetCardProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={pct(data.totals.degradedRatePct)} sub={t('eng.degradedSub')} />;
}

function EngCostCard({ days }: WidgetCardProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={usd(data.totals.costUsd)} sub={t('eng.costSub')} />;
}

/** Shared effectiveness ranking table (approach / model / action-type). */
function effectivenessTable(rows: EffectivenessBucket[], label: string, t: ReturnType<typeof useTranslations>): React.ReactNode {
  if (rows.length === 0) return <Muted>{t('eng.noRuns')}</Muted>;
  return (
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
              <td style={tdMutedStyle}>{int(b.runs)}</td>
              <td style={tdMutedStyle}>{score2(b.avgScore)}</td>
              <td style={tdMutedStyle}>{pct(b.mergedRatePct)}</td>
              <td style={tdMutedStyle}>{usd(b.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ByApproachCard({ days }: WidgetCardProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return effectivenessTable(data.byApproach, t('eng.approach'), t);
}

function ByModelCard({ days }: WidgetCardProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return effectivenessTable(data.byModel, t('eng.model'), t);
}

function ByActionTypeCard({ days }: WidgetCardProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return effectivenessTable(data.byActionType, t('eng.workType'), t);
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const FINANCE_WIDGETS: WidgetDef[] = [
  // Finance / FinOps
  { id: 'finance.spend', group: 'finance', titleKey: 'finSpend', capability: FIN_CAP, size: 'sm', Card: SpendCard, drill: FIN_DRILL },
  { id: 'finance.forecast', group: 'finance', titleKey: 'finForecast', capability: FIN_CAP, size: 'sm', Card: ForecastCard, drill: FIN_DRILL },
  { id: 'finance.cost-per-pr', group: 'finance', titleKey: 'finCostPerPr', capability: FIN_CAP, size: 'sm', Card: CostPerPrCard, drill: FIN_DRILL },
  { id: 'finance.paid-overflow', group: 'finance', titleKey: 'finPaidOverflow', capability: FIN_CAP, size: 'sm', Card: PaidOverflowCard, drill: FIN_DRILL },
  { id: 'finance.cache-read', group: 'finance', titleKey: 'finCacheRead', capability: FIN_CAP, size: 'sm', Card: CacheReadCard, drill: FIN_DRILL },
  { id: 'finance.spend-trend', group: 'finance', titleKey: 'finSpendTrend', capability: FIN_CAP, size: 'lg', Card: SpendTrendCard, drill: FIN_DRILL },
  { id: 'finance.budget-variance', group: 'finance', titleKey: 'finBudgetVariance', capability: FIN_CAP, size: 'md', Card: BudgetVarianceCard, drill: FIN_DRILL },
  { id: 'finance.by-project', group: 'finance', titleKey: 'finByProject', capability: FIN_CAP, size: 'md', Card: ByProjectCard, drill: FIN_DRILL },
  // Engineering effectiveness
  { id: 'engineering.outcome', group: 'engineering', titleKey: 'engOutcome', capability: ENG_CAP, size: 'sm', Card: OutcomeScoreCard, drill: ENG_DRILL },
  { id: 'engineering.merge-rate', group: 'engineering', titleKey: 'engMergeRate', capability: ENG_CAP, size: 'sm', Card: MergeRateCard, drill: ENG_DRILL },
  { id: 'engineering.ci-green', group: 'engineering', titleKey: 'engCiGreen', capability: ENG_CAP, size: 'sm', Card: CiGreenCard, drill: ENG_DRILL },
  { id: 'engineering.degraded', group: 'engineering', titleKey: 'engDegraded', capability: ENG_CAP, size: 'sm', Card: DegradedCard, drill: ENG_DRILL },
  { id: 'engineering.cost', group: 'engineering', titleKey: 'engCost', capability: ENG_CAP, size: 'sm', Card: EngCostCard, drill: ENG_DRILL },
  { id: 'engineering.by-approach', group: 'engineering', titleKey: 'engByApproach', capability: ENG_CAP, size: 'lg', Card: ByApproachCard, drill: ENG_DRILL },
  { id: 'engineering.by-model', group: 'engineering', titleKey: 'engByModel', capability: ENG_CAP, size: 'lg', Card: ByModelCard, drill: ENG_DRILL },
  { id: 'engineering.by-action-type', group: 'engineering', titleKey: 'engByActionType', capability: ENG_CAP, size: 'lg', Card: ByActionTypeCard, drill: ENG_DRILL },
];
