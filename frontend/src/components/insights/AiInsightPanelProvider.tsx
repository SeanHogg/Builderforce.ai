'use client';

/**
 * Global controller for the AI Insights hub's drill-down slide-out — the consolidated
 * /insights/ai dashboard drills into it, and the Brain opens the same panels via the
 * `show_ai_insight` tool (see AiInsightPanelBrainBridge). The drawer itself is
 * `createPanelProvider`; this file only names the hub's registry and namespace.
 */

import { createPanelProvider } from './createPanelProvider';
import { AI_INSIGHT_PANELS, AI_INSIGHT_PANEL_IDS, type AiInsightPanelId } from './aiInsightPanels';

const aiInsightPanel = createPanelProvider<AiInsightPanelId>({
  name: 'AiInsightPanel',
  namespace: 'insights.aihub',
  panels: AI_INSIGHT_PANEL_IDS.map((id) => AI_INSIGHT_PANELS[id]),
  widthStorageKey: 'ai-insights',
});

export const AiInsightPanelProvider = aiInsightPanel.Provider;
/** Open/close the AI insight drill-down panel. Throws outside the provider. */
export const useAiInsightPanel = aiInsightPanel.usePanel;
/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export const useOptionalAiInsightPanel = aiInsightPanel.useOptionalPanel;
