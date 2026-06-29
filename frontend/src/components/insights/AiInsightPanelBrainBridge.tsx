'use client';

/**
 * Registers the `show_ai_insight` Brain tool: lets the Brain open any AI insight
 * in the global slide-out side panel (over /brainstorm or the floating drawer).
 * The panels themselves come from the shared registry, so the Brain and the
 * dashboard drill-down open the exact same components.
 *
 * Mounted inside the AiInsightPanelProvider so it can drive the drawer, and
 * inside the Brain action providers so its tool reaches the model — see
 * ConditionalAppShell. Renders no UI (mirrors FinancePanelBrainBridge).
 */

import { useMemo } from 'react';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { AI_INSIGHT_PANELS, AI_INSIGHT_PANEL_IDS, isAiInsightPanelId, type AiInsightPanelId } from './aiInsightPanels';
import { useOptionalAiInsightPanel } from './AiInsightPanelProvider';

export function AiInsightPanelBrainBridge() {
  const panel = useOptionalAiInsightPanel();
  const open = panel?.open;

  const actions = useMemo<BrainAction[]>(() => {
    if (!open) return [];
    const menu = AI_INSIGHT_PANEL_IDS.map((id) => `"${id}"`).join(', ');
    return [
      {
        name: 'show_ai_insight',
        description:
          'Open a slide-out side panel showing an AI insight for the user. ' +
          `Use this when the user asks to see AI impact, AI adoption, AI effectiveness, which model/approach ships best, LLM/token usage, model health, AI cost/spend, or recommendations / what to do next. Panel ids: ${menu}. ` +
          'ai-impact = adoption & model-usage trends, multi-tool evaluation matrix & a composite AI productivity score; engineering = AI effectiveness (which approach actually ships — outcome score, merge rate & cost by work type and model); llm-usage = LLM token/request totals, provider & model health, learned model routing, and estimated spend broken down by source, project, user, team & repo; recommendations = ranked prescriptive actions + anomalies to act on.',
        parameters: {
          type: 'object',
          properties: {
            panel: { type: 'string', enum: AI_INSIGHT_PANEL_IDS, description: 'Which AI insight to show.' },
          },
          required: ['panel'],
        },
        mutates: false,
        run: (args: unknown) => {
          const id = (args as { panel?: unknown })?.panel;
          if (!isAiInsightPanelId(id)) {
            return { error: `Unknown panel. Valid ids: ${AI_INSIGHT_PANEL_IDS.join(', ')}.` };
          }
          open(id as AiInsightPanelId);
          return { opened: id, title: AI_INSIGHT_PANELS[id].titleKey };
        },
      },
    ];
  }, [open]);

  useRegisterBrainActions(actions);
  return null;
}
