'use client';

/**
 * Registers the `show_finance_insight` Brain tool: lets the Brain open any
 * finance insight in the global slide-out side panel (over /brainstorm or the
 * floating drawer). The panels come from the shared registry, so the Brain and
 * the hub's drill-down open the exact same components.
 *
 * Mounted inside the FinancePanelProvider so it can drive the drawer, and inside
 * the Brain action providers so its tool reaches the model — see
 * ConditionalAppShell. Renders no UI (mirrors PlatformActionsBridge).
 */

import { useMemo } from 'react';
import { useRegisterBrainActions, type BrainAction } from '@/lib/brain';
import { FINANCE_PANELS, FINANCE_PANEL_IDS, isFinancePanelId, type FinancePanelId } from './financePanels';
import { useOptionalFinancePanel } from './FinancePanelProvider';

export function FinancePanelBrainBridge() {
  const panel = useOptionalFinancePanel();
  const open = panel?.open;

  const actions = useMemo<BrainAction[]>(() => {
    if (!open) return [];
    return [
      {
        name: 'show_finance_insight',
        description:
          'Open a slide-out side panel showing a finance / FinOps insight for the user. ' +
          'Use this when the user asks to see spending, budgets, cost, investment allocation, capex/opex, ' +
          'R&D tax credits, SOC 1 controls, or an audit report. Panels: ' +
          '"finance" = AI spend, budgets vs actual, forecast & cost per merged PR; ' +
          '"allocation" = investment mix, capex/opex & capitalization; ' +
          '"devfinops" = R&D tax credit (QRE) estimate, SOC 1 control coverage & audit-ready report.',
        parameters: {
          type: 'object',
          properties: {
            panel: { type: 'string', enum: FINANCE_PANEL_IDS, description: 'Which finance insight to show.' },
          },
          required: ['panel'],
        },
        mutates: false,
        run: (args: unknown) => {
          const id = (args as { panel?: unknown })?.panel;
          if (!isFinancePanelId(id)) {
            return { error: `Unknown panel. Valid ids: ${FINANCE_PANEL_IDS.join(', ')}.` };
          }
          open(id as FinancePanelId);
          return { opened: id, title: FINANCE_PANELS.find((p) => p.id === id)?.titleKey };
        },
      },
    ];
  }, [open]);

  useRegisterBrainActions(actions);
  return null;
}
