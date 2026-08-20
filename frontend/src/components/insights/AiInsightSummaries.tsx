'use client';

import { useTranslations } from 'next-intl';
import { PLATFORM_PROVIDER_ID, type ProviderConsumption } from '@/lib/aiImpactApi';
import { type RecSeverity } from '@/lib/recommendationsApi';
import { PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { BarChart } from '@/components/charts/BarChart';
import { KpiGrid } from './LensShell';
import { pct, score2 } from './format';
import { useInsightFormat } from './format';
import { useAiOverview, useLlmUsage, useLlmBySource } from './insightsSources';

/**
 * Compact "at-a-glance" summaries for the combined AI Insights dashboard.
 *
 * Each summary reads the SAME collector its full lens reads (so the headline
 * numbers always agree) but renders only the KPI row — the full breakdown lives
 * in the drill-down slide-out (the lens itself). Kept tiny and self-contained so
 * the dashboard cards, the widget registry AND the Brain's slide-out can compose
 * them without prop drilling. `days` is owned by the shared window selector.
 *
 * The three `/ai-overview`-backed summaries used to be handed their slice by the
 * dashboard through `overrideData` / `bundleLoading` props, which meant the
 * component only made one round-trip when its ONE particular parent remembered
 * to bundle for it — and made three when anything else (a pinned widget, the
 * Brain) mounted them. They now read the bundle through the shared deduped
 * source {@link useAiOverview} instead, so the single round-trip is a property of
 * the data layer rather than of a parent's cooperation.
 */

const SEVERITY_COLOR: Record<RecSeverity, string> = {
  critical: 'var(--error)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

/**
 * Consumption per funding credential — the tenant's connected BYO integrations
 * and Builderforce's own platform key, ranked by tokens.
 *
 * Ranks and renders by TOKENS, never cost: BYO rows are recorded with cost 0 (the
 * tenant's own key paid the vendor), so a cost-ranked view shows a BYO tenant
 * nothing. Owns its own visibility — renders nothing when there is no usage.
 */
export function ProviderConsumptionBreakdown({ providers }: { providers: ProviderConsumption[] }) {
  const { usd, int, compactTokens } = useInsightFormat();
  const t = useTranslations('insights');
  if (providers.length === 0) return null;

  return (
    <div>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>
        {t('aiImpact.byIntegration')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {providers.map((p) => (
          <div
            key={p.provider}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, flexWrap: 'wrap',
              padding: '8px 12px', borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
              <span style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                {p.provider === PLATFORM_PROVIDER_ID ? t('aiImpact.platformKey') : p.provider}
              </span>
              <span
                style={{
                  fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap',
                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  color: p.byo ? 'var(--success-text, var(--success))' : 'var(--text-secondary)',
                  background: p.byo ? 'var(--success-bg, rgba(34, 197, 94, 0.12))' : 'var(--border)',
                }}
              >
                {p.byo ? t('aiImpact.fundedOwnKey') : t('aiImpact.fundedPlatform')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span title={t('aiImpact.requests')}>{int(p.requests)}</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{compactTokens(p.tokens)}</span>
              {/* BYO spend lands on the tenant's own vendor bill, so the platform
                  figure would read a misleading $0 — show a dash instead. */}
              <span style={{ minWidth: 52, textAlign: 'right' }}>{p.byo ? '—' : usd(p.costUsd)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiImpactSummary({ days }: { days: number }) {
  const { compactTokens } = useInsightFormat();
  const t = useTranslations('insights');
  const { data: overview, error } = useAiOverview(days);
  const data = overview?.aiImpact ?? null;

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={overview ? t('aiImpact.noUsage') : t('loading')} />;

  const p = data.productivity;
  const deltaSub = `${p.deltaPct >= 0 ? '+' : ''}${p.deltaPct.toFixed(0)}% ${t('aiImpact.wow')}`;

  // Tokens by model, straight off the usage ledger — every surface and BOTH
  // funding sources. Deliberately NOT `data.comparison`, which only covers
  // scored cloud runs and so renders nothing for a tenant on their own keys.
  const { models, totalTokens } = data.consumption;
  const byModel = models.map((m) => ({ key: m.model, label: m.model, value: m.tokens }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <KpiGrid>
        <StatCard label={t('aiImpact.tokens')} value={compactTokens(totalTokens)} sub={t('aiImpact.tokensSub')} />
        <StatCard label={t('aiImpact.productivityScore')} value={score2(p.score)} sub={deltaSub} />
        <StatCard label={t('aiImpact.throughput')} value={pct(p.throughput * 100)} sub={t('aiImpact.throughputSub')} />
        <StatCard label={t('aiImpact.quality')} value={pct(p.quality * 100)} sub={t('aiImpact.qualitySub')} />
        <StatCard label={t('aiImpact.efficiency')} value={pct(p.efficiency * 100)} sub={t('aiImpact.efficiencySub')} />
      </KpiGrid>

      {byModel.length > 0 && (
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>
            {t('aiImpact.tokensByModel')}
          </div>
          <BarChart
            data={byModel}
            maxRows={6}
            labelWidth={150}
            formatValue={compactTokens}
            ariaLabel={t('aiImpact.tokensByModel')}
          />
        </div>
      )}

      <ProviderConsumptionBreakdown providers={data.consumption.providers} />
    </div>
  );
}

export function LlmUsageSummary(_props: { days: number }) {
  const { usd, int, compactTokens } = useInsightFormat();
  const t = useTranslations('insights');
  // Provider totals are visible to any member; the cost roll-up is a manager
  // surface, so its read is tolerated to fail (the spend KPI shows "—" then).
  const { data: usage, error } = useLlmUsage();
  const { data: source } = useLlmBySource();

  if (error) return <PmError message={error} />;
  if (!usage) return <PmEmpty message={t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('llm.requests')} value={int(usage.totalRequests)} sub={t('llm.requestsSub')} />
      <StatCard label={t('llm.promptTokens')} value={compactTokens(usage.promptTokens)} sub={t('llm.tokensSub')} />
      <StatCard label={t('llm.completionTokens')} value={compactTokens(usage.completionTokens)} sub={t('llm.tokensSub')} />
      <StatCard label={t('llm.estCost')} value={source ? usd(source.totals.estimatedCostUsd) : '—'} sub={t('llm.estCostSub')} />
    </KpiGrid>
  );
}

export function EngineeringSummary({ days }: { days: number }) {
  const { usd } = useInsightFormat();
  const t = useTranslations('insights');
  const { data: overview, error } = useAiOverview(days);
  const data = overview?.engineering ?? null;

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={overview ? t('eng.noRuns') : t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('eng.runs')} value={String(data.totals.runs)} sub={t('days', { n: data.windowDays })} />
      <StatCard label={t('eng.avgScore')} value={score2(data.totals.avgScore)} sub={t('eng.scoreSub')} />
      <StatCard label={t('eng.mergeRate')} value={pct(data.totals.mergedRatePct)} sub={t('eng.mergeSub')} />
      <StatCard label={t('eng.cost')} value={usd(data.totals.costUsd)} sub={t('eng.costSub')} />
    </KpiGrid>
  );
}

export function RecommendationsSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data: overview, error } = useAiOverview(days);
  const data = overview?.recommendations ?? null;

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={overview ? t('recs.empty') : t('loading')} />;

  const recs = data.recommendations;
  if (recs.length === 0) return <PmEmpty message={t('recs.empty')} />;

  const counts = recs.reduce<Record<RecSeverity, number>>(
    (acc, r) => { acc[r.severity] = (acc[r.severity] ?? 0) + 1; return acc; },
    { critical: 0, warning: 0, info: 0 },
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(['critical', 'warning', 'info'] as RecSeverity[]).filter((s) => counts[s] > 0).map((s) => (
          <span
            key={s}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600,
              color: 'var(--text-on-accent)', background: SEVERITY_COLOR[s], padding: '4px 10px', borderRadius: 'var(--radius-full)',
            }}
          >
            {counts[s]} {t(`recs.severity.${s}`)}
          </span>
        ))}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {recs.slice(0, 3).map((r) => (
          <li key={r.key} style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.title}</span> — {r.metric}
          </li>
        ))}
      </ul>
    </div>
  );
}
