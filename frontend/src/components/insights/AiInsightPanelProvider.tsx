'use client';

/**
 * Global controller for the AI Insights hub's drill-down slide-out.
 *
 * Mounted once near the app root (see ConditionalAppShell) so ANY surface can
 * open an AI insight in a slide-out side panel without owning the drawer:
 *   - the consolidated /insights/ai dashboard drills down into a panel;
 *   - the Brain (on /brainstorm or the floating drawer) opens the same panels
 *     via the `show_ai_insight` tool (see AiInsightPanelBrainBridge).
 *
 * The panel content + titles come from the single registry in aiInsightPanels.tsx,
 * and each panel gates itself with <RoleGate> so visibility never has to be
 * computed by the caller. Mirrors the Finance hub's FinancePanelProvider.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { AI_INSIGHT_PANELS, type AiInsightPanelId } from './aiInsightPanels';

interface AiInsightPanelApi {
  /** Open an AI insight in the slide-out side panel. */
  open: (id: AiInsightPanelId) => void;
  close: () => void;
  active: AiInsightPanelId | null;
}

const AiInsightPanelContext = createContext<AiInsightPanelApi | null>(null);

export function AiInsightPanelProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('insights.aihub');
  const [active, setActive] = useState<AiInsightPanelId | null>(null);

  const open = useCallback((id: AiInsightPanelId) => setActive(id), []);
  const close = useCallback(() => setActive(null), []);

  const api = useMemo<AiInsightPanelApi>(() => ({ open, close, active }), [open, close, active]);
  const def = active ? AI_INSIGHT_PANELS[active] : null;

  // Let the user pivot across the AI reports without closing the drawer.
  const tabs = (Object.keys(AI_INSIGHT_PANELS) as AiInsightPanelId[]).map((id) => ({
    id,
    label: t(AI_INSIGHT_PANELS[id].titleKey),
  }));

  return (
    <AiInsightPanelContext.Provider value={api}>
      {children}
      <SlideOutPanel
        open={def != null}
        onClose={close}
        width={def?.width}
        title={def ? `${def.icon} ${t(def.titleKey)}` : undefined}
        tabs={tabs}
        activeTabId={active ?? undefined}
        onTabChange={(id) => setActive(id as AiInsightPanelId)}
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
    </AiInsightPanelContext.Provider>
  );
}

/**
 * Open/close the AI insight drill-down panel. Throws if used outside the
 * provider (the provider is mounted app-wide, so this only fires on a wiring
 * mistake).
 */
export function useAiInsightPanel(): AiInsightPanelApi {
  const ctx = useContext(AiInsightPanelContext);
  if (!ctx) throw new Error('useAiInsightPanel must be used within an AiInsightPanelProvider');
  return ctx;
}

/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export function useOptionalAiInsightPanel(): AiInsightPanelApi | null {
  return useContext(AiInsightPanelContext);
}
