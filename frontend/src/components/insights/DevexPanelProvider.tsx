'use client';

/**
 * Global controller for the DevEx hub's drill-down slide-out — the consolidated
 * /insights/devex dashboard drills into it, and the Brain opens the same panels via
 * the `show_devex_insight` tool (see DevexPanelBrainBridge). The drawer itself is
 * `createPanelProvider`; this file only names the hub's registry and namespace.
 */

import { createPanelProvider } from './createPanelProvider';
import { DEVEX_PANELS, DEVEX_PANEL_IDS, type DevexPanelId } from './devexPanels';

const devexPanel = createPanelProvider<DevexPanelId>({
  name: 'DevexPanel',
  namespace: 'insights.devexhub',
  panels: DEVEX_PANEL_IDS.map((id) => DEVEX_PANELS[id]),
  widthStorageKey: 'devex-insights',
});

export const DevexPanelProvider = devexPanel.Provider;
/** Open/close the DevEx drill-down panel. Throws outside the provider. */
export const useDevexPanel = devexPanel.usePanel;
/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export const useOptionalDevexPanel = devexPanel.useOptionalPanel;
