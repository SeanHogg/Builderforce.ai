/**
 * Registers the `show_finance_insight` Brain tool: lets the Brain open any
 * finance insight in the global slide-out side panel (over /brainstorm or the
 * floating drawer). The panels come from the shared registry, so the Brain and
 * the hub's drill-down open the exact same components.
 */

import { makePanelBrainBridge } from '../makePanelBrainBridge';
import { FINANCE_PANELS, FINANCE_PANEL_IDS, isFinancePanelId } from './financePanels';
import { useOptionalFinancePanel } from './FinancePanelProvider';

export const FinancePanelBrainBridge = makePanelBrainBridge({
  toolName: 'show_finance_insight',
  describe: () =>
    'Open a slide-out side panel showing a finance / FinOps insight for the user. ' +
    'Use this when the user asks to see spending, budgets, cost, investment allocation, capex/opex, ' +
    'R&D tax credits, SOC 1 controls, or an audit report. Panels: ' +
    '"finance" = AI spend, budgets vs actual, forecast & cost per merged PR; ' +
    '"allocation" = investment mix, capex/opex & capitalization; ' +
    '"devfinops" = R&D tax credit (QRE) estimate, SOC 1 control coverage & audit-ready report.',
  panelParamDescription: 'Which finance insight to show.',
  ids: FINANCE_PANEL_IDS,
  isId: isFinancePanelId,
  useOptionalPanel: useOptionalFinancePanel,
  titleOf: (id) => FINANCE_PANELS.find((p) => p.id === id)?.titleKey,
});
