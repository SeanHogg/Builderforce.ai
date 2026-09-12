'use client';

/**
 * Global controller for the Finance hub's drill-down slide-out — the consolidated
 * /insights/finance hub drills its tiles into it, and the Brain opens the same panels
 * via the `show_finance_insight` tool (see FinancePanelBrainBridge). The tabs let a
 * drill-down pivot between FinOps spend, allocation and DevFinOps in place. The drawer
 * itself is `createPanelProvider`; this file only names the hub's registry.
 */

import { createPanelProvider } from '../createPanelProvider';
import { FINANCE_PANELS, type FinancePanelId } from './financePanels';

const financePanel = createPanelProvider<FinancePanelId>({
  name: 'FinancePanel',
  namespace: 'insights',
  // The finance registry names its description line `subtitleKey` (it doubles as the
  // hub tile's subtitle); the drawer reads it as the description.
  panels: FINANCE_PANELS.map((panel) => ({ ...panel, descKey: panel.subtitleKey })),
  widthStorageKey: 'finance-insights',
  defaultWidth: 'wide',
});

export const FinancePanelProvider = financePanel.Provider;
/** Open/close the finance drill-down panel. Throws outside the provider. */
export const useFinancePanel = financePanel.usePanel;
/** Non-throwing variant for optional consumers (e.g. the Brain bridge). */
export const useOptionalFinancePanel = financePanel.useOptionalPanel;
