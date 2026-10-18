/**
 * Registers the `show_delivery_insight` Brain tool: lets the Brain open any
 * delivery insight in the global slide-out side panel (over /brainstorm or the
 * floating drawer). The panels themselves come from the shared registry, so the
 * Brain and the dashboard drill-down open the exact same components.
 */

import { makePanelBrainBridge } from './makePanelBrainBridge';
import { DELIVERY_PANELS, DELIVERY_PANEL_IDS, isDeliveryPanelId } from './deliveryPanels';
import { useOptionalDeliveryPanel } from './DeliveryPanelProvider';

export const DeliveryPanelBrainBridge = makePanelBrainBridge({
  toolName: 'show_delivery_insight',
  describe: (menu) =>
    'Open a slide-out side panel showing a delivery insight for the user. ' +
    `Use this when the user asks to see delivery progress/forecast, where work is stuck, whether tickets are completing autonomously, DORA / DevOps metrics, SPACE developer-productivity, how they rank vs the industry, or the innovation/idea funnel. Panel ids: ${menu}. ` +
    'delivery = burnup, forecast & scope creep for a deliverable; autonomy = Autonomy Health: per-ORIGIN lifecycle funnel (created → dispatched → progressed → Done → fully autonomous) comparing manager/agent-created vs human-created tickets, the autonomous-vs-human lane-move split, and the gates where autonomy stalls (no_agent, human_gate, run_cap_exhausted, cooldown_active…) — use it for "are the manager\'s tickets actually finishing themselves?"; bottlenecks = where work stalls (time-in-stage, slowest stage, rework, aging WIP); dora = the four DevOps keys vs performance tiers; space = the five-dimension developer-productivity framework; benchmarking = percentile & rating vs an industry cohort; funnel = idea → validated → built → shipped → measured conversion.',
  panelParamDescription: 'Which delivery insight to show.',
  ids: DELIVERY_PANEL_IDS,
  isId: isDeliveryPanelId,
  useOptionalPanel: useOptionalDeliveryPanel,
  titleOf: (id) => DELIVERY_PANELS[id].titleKey,
});
