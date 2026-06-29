'use client';

/**
 * Consolidated Delivery hub — the single entry point at /insights/delivery that
 * replaces the six separate routes (Delivery, Bottlenecks, DORA, SPACE,
 * Benchmarking and the Innovation Funnel). It shows one card per report with an
 * at-a-glance KPI summary, and each drills down into the full lens in an
 * interactive slide-out side panel (see DeliveryPanelProvider). Mirrors the AI
 * hub's AiInsightsDashboard.
 *
 * Each summary reads the SAME cached collector its lens reads (so headline
 * numbers agree); a shared 7/30/90-day window drives them all. A card whose
 * panel the user can't access renders the role hint instead of firing the read.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PmCard } from '@/components/pm/pmShared';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { DeliveryVerdict } from './DeliveryVerdict';
import { DaysWindowSelect } from './LensShell';
import { useDeliveryPanel } from './DeliveryPanelProvider';
import { DELIVERY_PANEL_IDS, DELIVERY_PANELS, isDeliveryPanelId, type DeliveryPanelDef, type DeliveryPanelId } from './deliveryPanels';

/** The "open the full lens" affordance, shared by every dashboard section. */
function DrillButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)',
        background: 'transparent', color: 'var(--accent, #2563eb)', cursor: 'pointer',
        fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap',
      }}
    >
      {label} →
    </button>
  );
}

/**
 * Render a panel's KPI summary, but only fetch when the user is entitled — an
 * un-entitled card shows the shared role hint (via RoleGate) instead of firing a
 * read that would 403. The card decides its own visibility from its capability,
 * so the dashboard never threads a `canX` boolean.
 */
function SummarySlot({ def, days }: { def: DeliveryPanelDef; days: number }) {
  const { allowed } = usePermission(def.capability);
  const Summary = def.Summary;
  if (!allowed) {
    return (
      <RoleGate capability={def.capability} variant="block">
        <div style={{ minHeight: 64 }} aria-hidden />
      </RoleGate>
    );
  }
  return <Summary days={days} />;
}

export function DeliveryDashboard() {
  const t = useTranslations('insights.delivhub');
  const [days, setDays] = useState(30);
  const { open } = useDeliveryPanel();
  const searchParams = useSearchParams();

  // Deep-link: /insights/delivery?panel=dora (and the redirects from the retired
  // /insights/bottlenecks, /dora, /space, /benchmarking, /funnel routes)
  // auto-open the drill-down.
  const panelParam = searchParams?.get('panel');
  useEffect(() => {
    if (isDeliveryPanelId(panelParam)) open(panelParam as DeliveryPanelId);
  }, [panelParam, open]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      {/* Narrative headline: are we delivering value? — the answer first. */}
      <DeliveryVerdict days={days} />

      {/* Denser two-up grid so the supporting reports read as one story, not a
          spaced-out stack of rows. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
        {DELIVERY_PANEL_IDS.map((id) => {
          const def = DELIVERY_PANELS[id];
          return (
            <PmCard
              key={id}
              title={`${def.icon} ${t(def.titleKey)}`}
              action={<DrillButton label={t('viewDetails')} onClick={() => open(id)} />}
            >
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '-6px 0 14px' }}>{t(def.descKey)}</p>
              <SummarySlot def={def} days={days} />
            </PmCard>
          );
        })}
      </div>
    </div>
  );
}
