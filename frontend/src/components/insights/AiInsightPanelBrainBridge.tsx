/**
 * Registers the `show_ai_insight` Brain tool: lets the Brain open any AI insight
 * in the global slide-out side panel (over /brainstorm or the floating drawer).
 * The panels themselves come from the shared registry, so the Brain and the
 * dashboard drill-down open the exact same components.
 */

import { makePanelBrainBridge } from './makePanelBrainBridge';
import { AI_INSIGHT_PANELS, AI_INSIGHT_PANEL_IDS, isAiInsightPanelId } from './aiInsightPanels';
import { useOptionalAiInsightPanel } from './AiInsightPanelProvider';

export const AiInsightPanelBrainBridge = makePanelBrainBridge({
  toolName: 'show_ai_insight',
  describe: (menu) =>
    'Open a slide-out side panel showing an AI insight for the user. ' +
    `Use this when the user asks to see AI impact, AI adoption, AI effectiveness, which model/approach ships best, LLM/token usage, model health, AI cost/spend, or recommendations / what to do next. Panel ids: ${menu}. ` +
    'ai-impact = adoption & model-usage trends, multi-tool evaluation matrix & a composite AI productivity score; engineering = AI effectiveness (which approach actually ships — outcome score, merge rate & cost by work type and model); llm-usage = LLM token/request totals, provider & model health, learned model routing, and estimated spend broken down by source, project, user, team & repo; recommendations = ranked prescriptive actions + anomalies to act on.',
  panelParamDescription: 'Which AI insight to show.',
  ids: AI_INSIGHT_PANEL_IDS,
  isId: isAiInsightPanelId,
  useOptionalPanel: useOptionalAiInsightPanel,
  titleOf: (id) => AI_INSIGHT_PANELS[id].titleKey,
});
