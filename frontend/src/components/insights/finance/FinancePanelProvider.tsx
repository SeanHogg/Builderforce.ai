'use client';

/**
 * Global controller for the Finance hub's drill-down slide-out.
 *
 * Mounted once near the app root (see ConditionalAppShell) so ANY surface can
 * open a finance insight in a slide-out side panel without owning the drawer:
 *   - the consolidated /insights/finance hub drills its tiles into a panel;
 *   - the Brain (on /brainstorm or the floating drawer) opens the same panels
 *     via the `show_finance_insight` tool (see FinancePanelBrainBridge).
 *
 * The slide-out tabs across every finance panel so a drill-down lets the user
 * pivot between FinOps spend, allocation and DevFinOps in place. Each panel gates
 * its own content with <RoleGate>, so callers never compute visibility. Built on
 * the stable SlideOutPanel primitive only.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { FINANCE_PANELS, getFinancePanel, type FinancePanelId } from './financePanels';

export interface FinancePanelApi {
  /** Open the slide-out on a finance panel. */
  open: (id: FinancePanelId) => void;
  close: () => void;
  /** Currently-open panel id, or null when closed. */
  active: FinancePanelId | null;
}

const FinancePanelContext = createContext<FinancePanelApi | null>(null);

export function FinancePanelProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('insights');
  const [active, setActive] = useState<FinancePanelId | null>(null);

  const open = useCallback((id: FinancePanelId) => setActive(id), []);
  const close = useCallback(() => setActive(null), []);

  const api = useMemo<FinancePanelApi>(() => ({ open, close, active }), [open, close, active]);

  const panel = getFinancePanel(active);
  const tabs = FINANCE_PANELS.map((p) => ({ id: p.id, label: t(p.titleKey) }));

  return (
    <FinancePanelContext.Provider value={api}>
      {children}
      <SlideOutPanel
        open={panel != null}
        onClose={close}
        width="min(960px, 96vw)"
        title={panel ? `${panel.icon} ${t(panel.titleKey)}` : ''}
        tabs={tabs}
        activeTabId={active ?? undefined}
        onTabChange={(id) => setActive(id as FinancePanelId)}
      >
        {panel && (
          <div style={{ padding: 20 }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: '0 0 18px' }}>
              {t(panel.subtitleKey)}
            </p>
            <RoleGate capability={panel.capability} variant="block">
              {panel.render()}
            </RoleGate>
          </div>
        )}
      </SlideOutPanel>
    </FinancePanelContext.Provider>
  );
}

/** Open/close the finance drill-down panel. Throws if used outside the provider. */
export function useFinancePanel(): FinancePanelApi {
  const ctx = useContext(FinancePanelContext);
  if (!ctx) throw new Error('useFinancePanel must be used within a FinancePanelProvider');
  return ctx;
}

/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export function useOptionalFinancePanel(): FinancePanelApi | null {
  return useContext(FinancePanelContext);
}
