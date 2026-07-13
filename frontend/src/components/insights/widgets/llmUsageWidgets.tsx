'use client';

/**
 * LLM Usage lens, decomposed into individually-pinnable widgets.
 *
 * LLM Usage used to live on its own tab under /workforce; it now folds into the
 * consolidated AI Insights hub as the `llm-usage` slide-out panel. Each headline
 * metric the report draws — token totals, request count, the by-model split, and
 * the cost-bearing by-source / by-project / spend breakdowns — is a standalone
 * {@link WidgetDef}, so a user can pin the exact tile they want onto any
 * dashboard. Every card reads the SAME source through the shared, deduped hooks
 * ({@link useLlmUsage} / {@link useLlmBySource}), renders only its body (the
 * WidgetCard chrome supplies frame + title + pin), and drills back into the full
 * LLM-Usage slide-out (see aiInsightPanels.tsx). Mirrors aiImpactWidgets.tsx.
 *
 * The spend-bearing cards (by-source, by-project, spend) carry estimated cost, so
 * they self-gate behind the finance capability exactly like the finance lens.
 */

import { useTranslations } from 'next-intl';
import { llmApi, dashboardApi, type LlmUsageStats, type DashboardUsage } from '@/lib/builderforceApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { colorAt } from '@/components/charts/chartColors';
import { usd, int, compactTokens } from '../format';

/** Drill back into the full LLM-Usage report (the AI Insights slide-out). */
const DRILL: WidgetDrill = { kind: 'panel', hub: 'ai', panel: 'llm-usage' };
/** Cost-bearing cards are a manager surface — gated like the finance lens. */
const FINANCE_CAP = 'insights.finance' as const;

// ── Shared, deduped data sources (one fetch per source regardless of pins) ──────

/** LLM provider usage totals + per-model split (`/llm/v1/usage`). */
function useLlmUsage() {
  return useSharedSource<LlmUsageStats>('llm:usage', () => llmApi.usage());
}

/** Token + estimated-cost usage split by source/project — cloud/on-prem/web (`/api/dashboard/usage`). */
function useLlmBySource() {
  return useSharedSource<DashboardUsage>('llm:by-source:week', () => dashboardApi.usage('week'));
}

// ── Card-body wrappers: own loading / error so each widget needn't repeat it ────

function useUsageBody() {
  const t = useTranslations('widgets');
  const { data, error } = useLlmUsage();
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

function useSourceBody() {
  const t = useTranslations('widgets');
  const { data, error } = useLlmBySource();
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

// ── Widget bodies (the WidgetCard owns the frame/title/pin) ─────────────────────

function LlmTokensCard(_props: WidgetCardProps) {
  const { data, state, t } = useUsageBody();
  if (!data) return state;
  return (
    <div>
      <Stat value={compactTokens(data.promptTokens + data.completionTokens)} sub={t('llmUsage.tokensSub')} />
      <div style={{ marginTop: 12 }}>
        <BarChart
          data={[
            { key: 'prompt', label: t('llmUsage.prompt'), value: data.promptTokens, color: colorAt(0) },
            { key: 'completion', label: t('llmUsage.completion'), value: data.completionTokens, color: colorAt(1) },
          ]}
          formatValue={(v) => compactTokens(v)}
          ariaLabel={t('llmUsage.tokenSplit')}
        />
      </div>
    </div>
  );
}

function LlmRequestsCard(_props: WidgetCardProps) {
  const { data, state, t } = useUsageBody();
  if (!data) return state;
  return <Stat value={int(data.totalRequests)} sub={t('llmUsage.requestsSub')} />;
}

function LlmByModelCard(_props: WidgetCardProps) {
  const { data, state, t } = useUsageBody();
  if (!data) return state;
  const models = (data.byModel ?? []).filter((m) => m.tokens > 0);
  if (models.length === 0) return <Muted>{t('llmUsage.noModels')}</Muted>;
  const bars = models
    .slice()
    .sort((a, b) => b.tokens - a.tokens)
    .map((m, i) => ({ key: m.model, label: m.model, value: m.tokens, color: colorAt(i) }));
  return <BarChart data={bars} maxRows={6} formatValue={(v) => compactTokens(v)} ariaLabel={t('llmUsage.byModel')} />;
}

function LlmSpendCard(_props: WidgetCardProps) {
  const { data, state, t } = useSourceBody();
  if (!data) return state;
  return <Stat value={usd(data.totals.estimatedCostUsd)} sub={t('llmUsage.spendSub')} />;
}

const SOURCE_LABEL: Record<DashboardUsage['byKind'][number]['kind'], string> = {
  cloud: 'Cloud',
  'on-prem': 'On-prem',
  web: 'Web / SDK',
};

function LlmBySourceCard(_props: WidgetCardProps) {
  const { data, state, t } = useSourceBody();
  if (!data) return state;
  const segments = data.byKind
    .filter((k) => k.estimatedCostUsd > 0)
    .map((k, i) => ({ key: k.kind, label: SOURCE_LABEL[k.kind], value: k.estimatedCostUsd, color: colorAt(i) }));
  if (segments.length === 0) return <Muted>{t('llmUsage.noSpend')}</Muted>;
  return (
    <DonutChart
      segments={segments}
      centerValue={usd(data.totals.estimatedCostUsd)}
      centerLabel={t('llmUsage.estCost')}
      formatValue={(v) => usd(v)}
      ariaLabel={t('llmUsage.bySource')}
    />
  );
}

function LlmByProjectCard(_props: WidgetCardProps) {
  const { data, state, t } = useSourceBody();
  if (!data) return state;
  const rows = data.perProject
    .filter((p) => p.estimatedCostUsd > 0)
    .slice()
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
    .map((p, i) => ({ key: String(p.projectId ?? 'none'), label: p.projectName, value: p.estimatedCostUsd, color: colorAt(i) }));
  if (rows.length === 0) return <Muted>{t('llmUsage.noProjects')}</Muted>;
  return <BarChart data={rows} maxRows={6} formatValue={(v) => usd(v)} ariaLabel={t('llmUsage.byProject')} />;
}

// ── Registry ─────────────────────────────────────────────────────────────────
// IDs keep the historical `core.llm-*` prefix so previously-saved pins survive
// the move out of coreWidgets.tsx.

export const LLM_USAGE_WIDGETS: WidgetDef[] = [
  { id: 'core.llm-tokens', group: 'llmUsage', titleKey: 'llmTokens', size: 'md', Card: LlmTokensCard, drill: DRILL },
  { id: 'core.llm-requests', group: 'llmUsage', titleKey: 'llmRequests', size: 'sm', Card: LlmRequestsCard, drill: DRILL },
  { id: 'core.llm-by-model', group: 'llmUsage', titleKey: 'llmByModel', size: 'md', Card: LlmByModelCard, drill: DRILL },
  { id: 'core.llm-spend', group: 'llmUsage', titleKey: 'llmSpend', capability: FINANCE_CAP, size: 'sm', Card: LlmSpendCard, drill: DRILL },
  { id: 'core.llm-by-source', group: 'llmUsage', titleKey: 'llmBySource', capability: FINANCE_CAP, size: 'md', Card: LlmBySourceCard, drill: DRILL },
  { id: 'core.llm-by-project', group: 'llmUsage', titleKey: 'llmByProject', capability: FINANCE_CAP, size: 'md', Card: LlmByProjectCard, drill: DRILL },
];
