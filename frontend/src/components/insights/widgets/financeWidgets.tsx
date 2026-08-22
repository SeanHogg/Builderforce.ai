'use client';

/**
 * Finance/FinOps lens + the AI-Effectiveness "Engineering" lens, decomposed into
 * individually-pinnable widgets.
 *
 * The Finance hub's FinanceLens (spend, forecast, cost-per-PR, paid overflow,
 * cache reads, spend-over-time, budgets, spend-by-project) and the Engineering
 * effectiveness lens (outcome score, merge rate, CI-green, degraded rate,
 * cost-per-merged work, the approach/model/action-type rankings) are each now a
 * standalone {@link ComponentDef} so a user can pin the exact tile they want onto
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
  type EffectivenessBucket,
} from '@/lib/builderforceApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted, useSourceState } from '@/components/widgets/widgetBody';
import type { ComponentSurfaceProps, ComponentDef, ComponentDrill } from '@/lib/components/types';
import { BarChart } from '@/components/charts/BarChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { pct, score2 } from '../format';
import { useInsightFormat, type InsightFormatters } from '../format';
import { useEngineering } from '../insightsSources';

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

const FIN_DRILL: ComponentDrill = { kind: 'panel', hub: 'finance', panel: 'finance' };
const ENG_DRILL: ComponentDrill = { kind: 'panel', hub: 'ai', panel: 'engineering' };
const FIN_CAP = 'insights.finance' as const;
const ENG_CAP = 'insights.engineering' as const;

// ── Small presentational bodies (the WidgetCard owns the frame/title/pin) ──────

/** Wrap a finance card body: handles loading / error so each widget needn't repeat it. */
function useFin() {
  const t = useTranslations('insights');
  const source = useFinance();
  return { data: source.data, state: useSourceState(source), t };
}

/** Wrap an engineering card body: handles loading / error. */
function useEng(days: number) {
  const t = useTranslations('insights');
  const source = useEngineering(days);
  return { data: source.data, state: useSourceState(source), t };
}

// ── Finance widget bodies ──────────────────────────────────────────────────────

function SpendCard(_: ComponentSurfaceProps) {
  const { usd } = useInsightFormat();
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={usd(data.totals.spendUsd)} sub={data.periodMonth} />;
}

function ForecastCard(_: ComponentSurfaceProps) {
  const { usd } = useInsightFormat();
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={usd(data.totals.forecastUsd)} sub={t('fin.forecastSub')} />;
}

function CostPerPrCard(_: ComponentSurfaceProps) {
  const { usd } = useInsightFormat();
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={usd(data.totals.costPerMergedPrUsd)} sub={t('fin.mergedRuns', { n: data.totals.mergedRuns })} />;
}

function PaidOverflowCard(_: ComponentSurfaceProps) {
  const { usd } = useInsightFormat();
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={usd(data.totals.paidOverflowUsd)} sub={t('fin.paidOverflowSub')} />;
}

function CacheReadCard(_: ComponentSurfaceProps) {
  const { int } = useInsightFormat();
  const { data, state, t } = useFin();
  if (!data) return state;
  return <Stat value={int(data.totals.cacheReadTokens)} sub={t('fin.cacheReadSub')} />;
}

function SpendTrendCard({ days }: ComponentSurfaceProps) {
  const { usd } = useInsightFormat();
  const { data, state, t } = useFin();
  if (!data) return state;
  // Honour the dashboard's shared window: show the last `days` days of the
  // month's daily spend series rather than always the whole month.
  const daily = days > 0 ? data.daily.slice(-days) : data.daily;
  if (daily.length === 0 || daily.every((d) => d.usd === 0)) return <Muted>{t('fin.noSpend')}</Muted>;
  return (
    <TrendChart
      labels={daily.map((d) => d.date.slice(5))}
      series={[{ key: 'spend', label: t('fin.spend'), values: daily.map((d) => d.usd) }]}
      area
      formatValue={(v) => usd(v)}
      ariaLabel={t('fin.spendOverTime')}
    />
  );
}

function BudgetVarianceCard(_: ComponentSurfaceProps) {
  const { usd } = useInsightFormat();
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

function ByProjectCard(_: ComponentSurfaceProps) {
  const { usd } = useInsightFormat();
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

function OutcomeScoreCard({ days }: ComponentSurfaceProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={score2(data.totals.avgScore)} sub={t('eng.scoreSub')} />;
}

function MergeRateCard({ days }: ComponentSurfaceProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={pct(data.totals.mergedRatePct)} sub={t('eng.mergeSub')} />;
}

function CiGreenCard({ days }: ComponentSurfaceProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={pct(data.totals.ciGreenRatePct)} sub={t('eng.ciSub')} />;
}

function DegradedCard({ days }: ComponentSurfaceProps) {
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={pct(data.totals.degradedRatePct)} sub={t('eng.degradedSub')} />;
}

function EngCostCard({ days }: ComponentSurfaceProps) {
  const { usd } = useInsightFormat();
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return <Stat value={usd(data.totals.costUsd)} sub={t('eng.costSub')} />;
}

/** Shared effectiveness ranking table (approach / model / action-type). */
function effectivenessTable(f: InsightFormatters, rows: EffectivenessBucket[], label: string, t: ReturnType<typeof useTranslations>): React.ReactNode {
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
              <td style={tdMutedStyle}>{f.int(b.runs)}</td>
              <td style={tdMutedStyle}>{score2(b.avgScore)}</td>
              <td style={tdMutedStyle}>{pct(b.mergedRatePct)}</td>
              <td style={tdMutedStyle}>{f.usd(b.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ByApproachCard({ days }: ComponentSurfaceProps) {
  const insight = useInsightFormat();
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return effectivenessTable(insight, data.byApproach, t('eng.approach'), t);
}

function ByModelCard({ days }: ComponentSurfaceProps) {
  const insight = useInsightFormat();
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return effectivenessTable(insight, data.byModel, t('eng.model'), t);
}

function ByActionTypeCard({ days }: ComponentSurfaceProps) {
  const insight = useInsightFormat();
  const { data, state, t } = useEng(days);
  if (!data) return state;
  return effectivenessTable(insight, data.byActionType, t('eng.workType'), t);
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const FINANCE_COMPONENTS: ComponentDef[] = [
  // Finance / FinOps
  { id: 'finance.spend', group: 'finance', titleKey: 'finSpend', capability: FIN_CAP, size: 'sm', Surface: SpendCard, drill: FIN_DRILL },
  { id: 'finance.forecast', group: 'finance', titleKey: 'finForecast', capability: FIN_CAP, size: 'sm', Surface: ForecastCard, drill: FIN_DRILL },
  { id: 'finance.cost-per-pr', group: 'finance', titleKey: 'finCostPerPr', capability: FIN_CAP, size: 'sm', Surface: CostPerPrCard, drill: FIN_DRILL },
  { id: 'finance.paid-overflow', group: 'finance', titleKey: 'finPaidOverflow', capability: FIN_CAP, size: 'sm', Surface: PaidOverflowCard, drill: FIN_DRILL },
  { id: 'finance.cache-read', group: 'finance', titleKey: 'finCacheRead', capability: FIN_CAP, size: 'sm', Surface: CacheReadCard, drill: FIN_DRILL },
  { id: 'finance.spend-trend', group: 'finance', titleKey: 'finSpendTrend', capability: FIN_CAP, size: 'lg', Surface: SpendTrendCard, drill: FIN_DRILL },
  { id: 'finance.budget-variance', group: 'finance', titleKey: 'finBudgetVariance', capability: FIN_CAP, size: 'md', Surface: BudgetVarianceCard, drill: FIN_DRILL },
  { id: 'finance.by-project', group: 'finance', titleKey: 'finByProject', capability: FIN_CAP, size: 'md', Surface: ByProjectCard, drill: FIN_DRILL },
  // Engineering effectiveness
  { id: 'engineering.outcome', group: 'engineering', titleKey: 'engOutcome', capability: ENG_CAP, size: 'sm', Surface: OutcomeScoreCard, drill: ENG_DRILL },
  { id: 'engineering.merge-rate', group: 'engineering', titleKey: 'engMergeRate', capability: ENG_CAP, size: 'sm', Surface: MergeRateCard, drill: ENG_DRILL },
  { id: 'engineering.ci-green', group: 'engineering', titleKey: 'engCiGreen', capability: ENG_CAP, size: 'sm', Surface: CiGreenCard, drill: ENG_DRILL },
  { id: 'engineering.degraded', group: 'engineering', titleKey: 'engDegraded', capability: ENG_CAP, size: 'sm', Surface: DegradedCard, drill: ENG_DRILL },
  { id: 'engineering.cost', group: 'engineering', titleKey: 'engCost', capability: ENG_CAP, size: 'sm', Surface: EngCostCard, drill: ENG_DRILL },
  { id: 'engineering.by-approach', group: 'engineering', titleKey: 'engByApproach', capability: ENG_CAP, size: 'lg', Surface: ByApproachCard, drill: ENG_DRILL },
  { id: 'engineering.by-model', group: 'engineering', titleKey: 'engByModel', capability: ENG_CAP, size: 'lg', Surface: ByModelCard, drill: ENG_DRILL },
  { id: 'engineering.by-action-type', group: 'engineering', titleKey: 'engByActionType', capability: ENG_CAP, size: 'lg', Surface: ByActionTypeCard, drill: ENG_DRILL },
];
