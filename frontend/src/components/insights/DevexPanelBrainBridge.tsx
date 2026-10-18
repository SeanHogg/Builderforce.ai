/**
 * Registers the `show_devex_insight` Brain tool: lets the Brain open any DevEx
 * surface in the global slide-out side panel (over /brainstorm or the floating
 * drawer). The panels come from the shared registry, so the Brain and the
 * dashboard drill-down open the exact same components.
 */

import { makePanelBrainBridge } from './makePanelBrainBridge';
import { DEVEX_PANELS, DEVEX_PANEL_IDS, isDevexPanelId } from './devexPanels';
import { useOptionalDevexPanel } from './DevexPanelProvider';

export const DevexPanelBrainBridge = makePanelBrainBridge({
  toolName: 'show_devex_insight',
  describe: (menu) =>
    'Open a slide-out side panel showing a developer-experience (DevEx) surface for the user. ' +
    `Use this when the user asks to see DevEx survey results, the DevEx index, eNPS, developer sentiment, AI-tools sentiment, survey participation, or to author/launch a pulse survey. Panel ids: ${menu}. ` +
    'results = the DevEx Index, per-topic scores with trend/benchmark/sentiment, the segment heatmap, participation over time and how priorities have shifted; surveys = author survey templates, launch campaigns, and view/respond to responses.',
  panelParamDescription: 'Which DevEx surface to show.',
  ids: DEVEX_PANEL_IDS,
  isId: isDevexPanelId,
  useOptionalPanel: useOptionalDevexPanel,
  titleOf: (id) => DEVEX_PANELS[id].titleKey,
});
