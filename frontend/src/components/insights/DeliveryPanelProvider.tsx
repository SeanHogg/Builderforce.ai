'use client';

/**
 * Global controller for the Delivery hub's drill-down slide-out.
 *
 * Mounted once near the app root (see ConditionalAppShell) so ANY surface can
 * open a delivery insight in a slide-out side panel without owning the drawer:
 *   - the consolidated /insights/delivery dashboard drills down into a panel;
 *   - the Brain (on /brainstorm or the floating drawer) opens the same panels
 *     via the `show_delivery_insight` tool (see DeliveryPanelBrainBridge).
 *
 * The panel content + titles come from the single registry in deliveryPanels.tsx,
 * and each panel gates itself with <RoleGate> so visibility never has to be
 * computed by the caller. Mirrors the AI hub's AiInsightPanelProvider.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { DELIVERY_PANELS, type DeliveryPanelId } from './deliveryPanels';

interface DeliveryPanelApi {
  /** Open a delivery insight in the slide-out side panel. */
  open: (id: DeliveryPanelId) => void;
  close: () => void;
  active: DeliveryPanelId | null;
}

const DeliveryPanelContext = createContext<DeliveryPanelApi | null>(null);

export function DeliveryPanelProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('insights.delivhub');
  const [active, setActive] = useState<DeliveryPanelId | null>(null);

  const open = useCallback((id: DeliveryPanelId) => setActive(id), []);
  const close = useCallback(() => setActive(null), []);

  const api = useMemo<DeliveryPanelApi>(() => ({ open, close, active }), [open, close, active]);
  const def = active ? DELIVERY_PANELS[active] : null;

  // Let the user pivot across the delivery reports without closing the drawer.
  const tabs = (Object.keys(DELIVERY_PANELS) as DeliveryPanelId[]).map((id) => ({
    id,
    label: t(DELIVERY_PANELS[id].titleKey),
  }));

  return (
    <DeliveryPanelContext.Provider value={api}>
      {children}
      <SlideOutPanel
        open={def != null}
        onClose={close}
        width={def?.width}
        title={def ? `${def.icon} ${t(def.titleKey)}` : undefined}
        tabs={tabs}
        activeTabId={active ?? undefined}
        onTabChange={(id) => setActive(id as DeliveryPanelId)}
      >
        {def && (
          <div style={{ padding: 20 }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: '0 0 18px' }}>{t(def.descKey)}</p>
            <RoleGate capability={def.capability} variant="block">
              {def.render()}
            </RoleGate>
          </div>
        )}
      </SlideOutPanel>
    </DeliveryPanelContext.Provider>
  );
}

/**
 * Open/close the delivery insight drill-down panel. Throws if used outside the
 * provider (the provider is mounted app-wide, so this only fires on a wiring
 * mistake).
 */
export function useDeliveryPanel(): DeliveryPanelApi {
  const ctx = useContext(DeliveryPanelContext);
  if (!ctx) throw new Error('useDeliveryPanel must be used within a DeliveryPanelProvider');
  return ctx;
}

/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export function useOptionalDeliveryPanel(): DeliveryPanelApi | null {
  return useContext(DeliveryPanelContext);
}
