'use client';

/**
 * Global controller for the Delivery hub's drill-down slide-out — the consolidated
 * /insights/delivery dashboard drills into it, and the Brain opens the same panels via
 * the `show_delivery_insight` tool (see DeliveryPanelBrainBridge). The drawer itself is
 * `createPanelProvider`; this file only names the hub's registry and namespace.
 */

import { createPanelProvider } from './createPanelProvider';
import { DELIVERY_PANELS, DELIVERY_PANEL_IDS, type DeliveryPanelId } from './deliveryPanels';

const deliveryPanel = createPanelProvider<DeliveryPanelId>({
  name: 'DeliveryPanel',
  namespace: 'insights.delivhub',
  panels: DELIVERY_PANEL_IDS.map((id) => DELIVERY_PANELS[id]),
  widthStorageKey: 'delivery-insights',
});

export const DeliveryPanelProvider = deliveryPanel.Provider;
/** Open/close the delivery insight drill-down panel. Throws outside the provider. */
export const useDeliveryPanel = deliveryPanel.usePanel;
/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export const useOptionalDeliveryPanel = deliveryPanel.useOptionalPanel;
