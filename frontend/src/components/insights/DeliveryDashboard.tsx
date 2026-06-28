'use client';

/**
 * Consolidated Delivery hub — the single entry point at /insights/delivery that
 * replaces the six separate routes (Delivery, Bottlenecks, DORA, SPACE,
 * Benchmarking and the Innovation Funnel). It shows one tile per report, and
 * each drills down into the full lens in an interactive slide-out side panel
 * (see DeliveryPanelProvider). Mirrors the AI hub's AiInsightsDashboard.
 *
 * Unlike the AI / Finance hubs (compact KPI summaries), each delivery lens owns
 * heavy data + its own time-window controls, so the dashboard stays a fast
 * launcher (no per-tile fan-out reads) and the detail lives in the drill-down.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDeliveryPanel } from './DeliveryPanelProvider';
import { DELIVERY_PANEL_IDS, DELIVERY_PANELS, isDeliveryPanelId, type DeliveryPanelId } from './deliveryPanels';

export function DeliveryDashboard() {
  const t = useTranslations('insights.delivhub');
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
      {DELIVERY_PANEL_IDS.map((id) => {
        const def = DELIVERY_PANELS[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => open(id)}
            style={tileStyle}
            aria-label={t('openLens', { name: t(def.titleKey) })}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span aria-hidden style={{ fontSize: '1.4rem', lineHeight: 1 }}>{def.icon}</span>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{t(def.titleKey)}</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{t(def.descKey)}</p>
            <span style={{ marginTop: 'auto', fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent, #2563eb)' }}>
              {t('viewDetails')} →
            </span>
          </button>
        );
      })}
    </div>
  );
}

const tileStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', minHeight: 150, padding: 18,
  borderRadius: 14, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', cursor: 'pointer',
};
