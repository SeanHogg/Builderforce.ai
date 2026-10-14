/**
 * The `metric` panel kind's body (PRD 33 §4.1 "trend, breakdowns, segments";
 * §2.1 "Dashboard"): the Overview over the window and the ONE filter — the
 * numbers (`OverviewTiles`), the daily trend (the shared `TrendChart`), and the
 * top lists (`OverviewBreakdowns`). Unfiltered it is exact; filtered it is ≈.
 *
 * A breakdown row narrows the filter in place; a frustration tile narrows it to
 * that signal and opens the issues behind it. The top three open fixes for the
 * same filter lead (THE fix card, compact — D13: fixes lead, numbers are evidence).
 */

import { useTranslations } from 'next-intl';
import type { FrustrationMarkKind, ReplayFilterClause, ReplayOverviewDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';
import { useAdminData } from '@/components/admin/adminShared';
import { TrendChart } from '@/components/charts/TrendChart';
import { PanelPending } from '@/components/insights/kinds/PanelPending';
import { useInsightsScope } from '@/components/insights/insightsScope';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { addClause } from '../filter/useReplayFilter';
import { PrescriptionCard } from '../prescriptions/PrescriptionCard';
import { isOpenPrescription } from '../prescriptions/prescriptionModel';
import { usePrescriptionsFor } from '../prescriptions/usePrescriptionsFor';
import { OverviewBreakdowns } from './OverviewBreakdowns';
import { OverviewTiles } from './OverviewTiles';

export interface OverviewViewProps {
  siteId: string;
  push: (level: InsightPanelLevel) => void;
}

const heading = { margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' } as const;

/** Fixes the Overview leads with. */
export const OVERVIEW_TOP_FIXES = 3;

export function OverviewView({ siteId, push }: OverviewViewProps) {
  const t = useTranslations('replay.overview');
  const tFixes = useTranslations('replay.fixes');
  const fmt = useFormat();
  const { days, filter, setFilter } = useInsightsScope();
  const filterKey = JSON.stringify(filter);
  const { data, loading, error } = useAdminData<ReplayOverviewDto>(
    () => replayApi.getOverview(siteId, { days, filter }),
    [siteId, days, filterKey],
  );
  const fixes = usePrescriptionsFor({ siteId, filter }).items.filter(isOpenPrescription).slice(0, OVERVIEW_TOP_FIXES);
  if (!data) return <PanelPending loading={loading} error={error} />;

  const narrow = (clause: ReplayFilterClause) => setFilter(addClause(filter, clause));
  const openFrustration = (kind: FrustrationMarkKind) => {
    narrow({ field: 'frustration', op: 'eq', value: kind });
    push({ kind: 'issues', id: '' });
  };
  const labels = data.trend.map((point) => fmt.dateWith(point.day, { month: 'short', day: 'numeric' }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
      {data.estimated && (
        <p role="note" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('estimatedNote')}</p>
      )}
      {fixes.length > 0 && (
        <section aria-label={tFixes('overviewTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h3 style={heading}>{tFixes('overviewTitle')}</h3>
          {fixes.map((p) => <PrescriptionCard key={p.id} compact siteId={siteId} prescription={p} push={push} />)}
        </section>
      )}
      <OverviewTiles overview={data} onFrustration={openFrustration} />
      {data.trend.length > 1 && (
        <section aria-label={t('trendTitle', { days })}>
          <h3 style={heading}>{t('trendTitle', { days })}</h3>
          <TrendChart
            labels={labels}
            series={[{ key: 'sessions', label: t('tile.sessions'), values: data.trend.map((point) => point.sessions), color: 'var(--accent)' }]}
            area
            height={160}
            ariaLabel={t('trendSessionsAria')}
          />
          <TrendChart
            labels={labels}
            series={[{ key: 'frustrated', label: t('trendFrustrated'), values: data.trend.map((point) => point.frustratedPct), color: 'var(--warning)' }]}
            height={120}
            formatValue={(value) => fmt.percent(value / 100)}
            ariaLabel={t('trendFrustratedAria')}
          />
        </section>
      )}
      <section aria-label={t('breakdownsTitle')}>
        <h3 style={heading}>{t('breakdownsTitle')}</h3>
        <OverviewBreakdowns overview={data} onAdd={narrow} />
      </section>
    </div>
  );
}
