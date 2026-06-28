'use client';

/**
 * Registers the `show_delivery_insight` Brain tool: lets the Brain open any
 * delivery insight in the global slide-out side panel (over /brainstorm or the
 * floating drawer). The panels themselves come from the shared registry, so the
 * Brain and the dashboard drill-down open the exact same components.
 *
 * Mounted inside the DeliveryPanelProvider so it can drive the drawer, and inside
 * the Brain action providers so its tool reaches the model — see
 * ConditionalAppShell. Renders no UI (mirrors AiInsightPanelBrainBridge).
 */

import { useMemo } from 'react';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { DELIVERY_PANELS, DELIVERY_PANEL_IDS, isDeliveryPanelId, type DeliveryPanelId } from './deliveryPanels';
import { useOptionalDeliveryPanel } from './DeliveryPanelProvider';

export function DeliveryPanelBrainBridge() {
  const panel = useOptionalDeliveryPanel();
  const open = panel?.open;

  const actions = useMemo<BrainAction[]>(() => {
    if (!open) return [];
    const menu = DELIVERY_PANEL_IDS.map((id) => `"${id}"`).join(', ');
    return [
      {
        name: 'show_delivery_insight',
        description:
          'Open a slide-out side panel showing a delivery insight for the user. ' +
          `Use this when the user asks to see delivery progress/forecast, where work is stuck, DORA / DevOps metrics, SPACE developer-productivity, how they rank vs the industry, or the innovation/idea funnel. Panel ids: ${menu}. ` +
          'delivery = burnup, forecast & scope creep for a deliverable; bottlenecks = where work stalls (time-in-stage, slowest stage, rework, aging WIP); dora = the four DevOps keys vs performance tiers; space = the five-dimension developer-productivity framework; benchmarking = percentile & rating vs an industry cohort; funnel = idea → validated → built → shipped → measured conversion.',
        parameters: {
          type: 'object',
          properties: {
            panel: { type: 'string', enum: DELIVERY_PANEL_IDS, description: 'Which delivery insight to show.' },
          },
          required: ['panel'],
        },
        mutates: false,
        run: (args: unknown) => {
          const id = (args as { panel?: unknown })?.panel;
          if (!isDeliveryPanelId(id)) {
            return { error: `Unknown panel. Valid ids: ${DELIVERY_PANEL_IDS.join(', ')}.` };
          }
          open(id as DeliveryPanelId);
          return { opened: id, title: DELIVERY_PANELS[id].titleKey };
        },
      },
    ];
  }, [open]);

  useRegisterBrainActions(actions);
  return null;
}
