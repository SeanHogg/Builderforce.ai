'use client';

/**
 * Consolidated Finance hub — the single entry point at /insights/finance that
 * replaces the three separate routes (FinOps spend, Investment Allocation and
 * DevFinOps). It is a real at-a-glance dashboard: each section shows live KPIs,
 * and "View details" drills into the full lens in the shared slide-out side
 * panel (see FinancePanelProvider) so the user can review detail in place.
 *
 * Performance: the whole summary is ONE bundled read — the DevFinOps audit
 * report already rolls up finance + allocation + R&D + SOC + compliance — so the
 * landing page never fans out N separate calls to render its tiles.
 *
 * Built as a plain reusable component (no page chrome of its own) so the Brain
 * can drop it into a conversation too. `initialDrill` lets the retired-route
 * redirects deep-link straight into a panel.
 */

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { getAuditReport, type AuditReport } from '@/lib/finopsApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { KpiGrid } from '@/components/insights/LensShell';
import { usd, pct, hrs, int } from '@/components/insights/format';
import { useFinancePanel } from './FinancePanelProvider';
import { isFinancePanelId, type FinancePanelId } from './financePanels';

/** "Open the full lens" affordance, shared by every section header (DRY). */
function DrillLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: '0.82rem', fontWeight: 600, padding: '6px 12px', borderRadius: 8,
        border: '1px solid var(--border-subtle)', background: 'transparent',
        color: 'var(--coral-bright, #f4726e)', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label} →
    </button>
  );
}

export function FinanceHub({ initialDrill }: { initialDrill?: string }) {
  const t = useTranslations('insights');
  const tf = useTranslations('finops');
  const { open } = useFinancePanel();
  const { data, error } = usePmData<AuditReport>(() => getAuditReport(), []);

  useEffect(() => {
    if (isFinancePanelId(initialDrill)) open(initialDrill as FinancePanelId);
  }, [initialDrill, open]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const drill = (id: FinancePanelId) => <DrillLink label={t('finhub.viewDetails')} onClick={() => open(id)} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── FinOps spend ── */}
      <PmCard title={`💰 ${t('fin.title')}`} action={drill('finance')}>
        <KpiGrid>
          <StatCard label={t('fin.spend')} value={usd(data.finance.spendUsd)} sub={data.period} />
          <StatCard label={t('fin.forecast')} value={usd(data.finance.forecastUsd)} sub={t('fin.forecastSub')} />
          <StatCard label={t('fin.costPerPr')} value={usd(data.finance.costPerMergedPrUsd)} />
          <StatCard label={t('fin.paidOverflow')} value={usd(data.finance.paidOverflowUsd)} sub={t('fin.paidOverflowSub')} />
        </KpiGrid>
      </PmCard>

      {/* ── Investment allocation (capex / opex) ── */}
      <PmCard title={`🧭 ${t('alloc.title')}`} action={drill('allocation')}>
        <KpiGrid>
          <StatCard label={t('alloc.totalHours')} value={hrs(data.allocation.hours)} />
          <StatCard label={t('alloc.capitalizable')} value={pct(data.allocation.capitalizablePct)} sub={t('alloc.capitalizableSub')} />
          <StatCard label={t('alloc.capex')} value={usd(data.allocation.capexUsd)} sub={t('alloc.capexSub')} />
          <StatCard label={t('alloc.opex')} value={usd(data.allocation.opexUsd)} sub={t('alloc.opexSub')} />
        </KpiGrid>
      </PmCard>

      {/* ── DevFinOps (R&D / SOC / audit) ── */}
      <PmCard title={`🧾 ${t('finhub.devfinops.title')}`} action={drill('devfinops')}>
        <KpiGrid>
          <StatCard label={tf('rd.qualifiedBase')} value={usd(data.rdTaxCredit.qualifiedBaseUsd)} sub={tf('rd.form6765')} />
          <StatCard label={tf('soc.coverage')} value={pct(data.socControls.coveragePct)} sub={tf('soc.implementedOfTotal', { a: data.socControls.implemented, b: data.socControls.total })} />
          <StatCard label={tf('audit.evidenceEvents')} value={int(data.compliance.totalEvents)} sub={tf('audit.sensitive', { n: data.compliance.sensitiveEvents })} />
        </KpiGrid>
      </PmCard>
    </div>
  );
}
