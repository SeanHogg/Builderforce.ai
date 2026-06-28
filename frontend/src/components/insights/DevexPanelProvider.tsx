'use client';

/**
 * Global controller for the DevEx hub's drill-down slide-out.
 *
 * Mounted once near the app root (see ConditionalAppShell) so ANY surface can
 * open a DevEx surface in a slide-out side panel without owning the drawer:
 *   - the consolidated /insights/devex dashboard drills down into a panel;
 *   - the Brain (on /brainstorm or the floating drawer) opens the same panels
 *     via the `show_devex_insight` tool (see DevexPanelBrainBridge).
 *
 * The panel content + titles come from the single registry in devexPanels.tsx,
 * and each panel gates itself with <RoleGate> so visibility never has to be
 * computed by the caller. Mirrors the AI hub's AiInsightPanelProvider.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { DEVEX_PANELS, type DevexPanelId } from './devexPanels';

interface DevexPanelApi {
  /** Open a DevEx surface in the slide-out side panel. */
  open: (id: DevexPanelId) => void;
  close: () => void;
  active: DevexPanelId | null;
}

const DevexPanelContext = createContext<DevexPanelApi | null>(null);

export function DevexPanelProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('insights.devexhub');
  const [active, setActive] = useState<DevexPanelId | null>(null);

  const open = useCallback((id: DevexPanelId) => setActive(id), []);
  const close = useCallback(() => setActive(null), []);

  const api = useMemo<DevexPanelApi>(() => ({ open, close, active }), [open, close, active]);
  const def = active ? DEVEX_PANELS[active] : null;

  // Let the user pivot across the DevEx surfaces without closing the drawer.
  const tabs = (Object.keys(DEVEX_PANELS) as DevexPanelId[]).map((id) => ({
    id,
    label: t(DEVEX_PANELS[id].titleKey),
  }));

  return (
    <DevexPanelContext.Provider value={api}>
      {children}
      <SlideOutPanel
        open={def != null}
        onClose={close}
        width={def?.width}
        title={def ? `${def.icon} ${t(def.titleKey)}` : undefined}
        tabs={tabs}
        activeTabId={active ?? undefined}
        onTabChange={(id) => setActive(id as DevexPanelId)}
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
    </DevexPanelContext.Provider>
  );
}

/**
 * Open/close the DevEx drill-down panel. Throws if used outside the provider
 * (the provider is mounted app-wide, so this only fires on a wiring mistake).
 */
export function useDevexPanel(): DevexPanelApi {
  const ctx = useContext(DevexPanelContext);
  if (!ctx) throw new Error('useDevexPanel must be used within a DevexPanelProvider');
  return ctx;
}

/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export function useOptionalDevexPanel(): DevexPanelApi | null {
  return useContext(DevexPanelContext);
}
