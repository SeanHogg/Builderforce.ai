'use client';

/**
 * Registers the `show_devex_insight` Brain tool: lets the Brain open any DevEx
 * surface in the global slide-out side panel (over /brainstorm or the floating
 * drawer). The panels come from the shared registry, so the Brain and the
 * dashboard drill-down open the exact same components.
 *
 * Mounted inside the DevexPanelProvider so it can drive the drawer, and inside
 * the Brain action providers so its tool reaches the model — see
 * ConditionalAppShell. Renders no UI (mirrors AiInsightPanelBrainBridge).
 */

import { useMemo } from 'react';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { DEVEX_PANELS, DEVEX_PANEL_IDS, isDevexPanelId, type DevexPanelId } from './devexPanels';
import { useOptionalDevexPanel } from './DevexPanelProvider';

export function DevexPanelBrainBridge() {
  const panel = useOptionalDevexPanel();
  const open = panel?.open;

  const actions = useMemo<BrainAction[]>(() => {
    if (!open) return [];
    const menu = DEVEX_PANEL_IDS.map((id) => `"${id}"`).join(', ');
    return [
      {
        name: 'show_devex_insight',
        description:
          'Open a slide-out side panel showing a developer-experience (DevEx) surface for the user. ' +
          `Use this when the user asks to see DevEx survey results, the DevEx index, eNPS, developer sentiment, AI-tools sentiment, survey participation, or to author/launch a pulse survey. Panel ids: ${menu}. ` +
          'results = the DevEx Index, per-topic scores with trend/benchmark/sentiment, the segment heatmap, participation over time and how priorities have shifted; surveys = author survey templates, launch campaigns, and view/respond to responses.',
        parameters: {
          type: 'object',
          properties: {
            panel: { type: 'string', enum: DEVEX_PANEL_IDS, description: 'Which DevEx surface to show.' },
          },
          required: ['panel'],
        },
        mutates: false,
        run: (args: unknown) => {
          const id = (args as { panel?: unknown })?.panel;
          if (!isDevexPanelId(id)) {
            return { error: `Unknown panel. Valid ids: ${DEVEX_PANEL_IDS.join(', ')}.` };
          }
          open(id as DevexPanelId);
          return { opened: id, title: DEVEX_PANELS[id].titleKey };
        },
      },
    ];
  }, [open]);

  useRegisterBrainActions(actions);
  return null;
}
