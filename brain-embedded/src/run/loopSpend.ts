/**
 * The agent's SPEND METER over a Brain run (PRD 35 §4 WS4, "the run's USD cap"): the run TREE's total the Brain already keeps
 * (`runStore/runSpendBudget.ts`: an owner and every sub-agent under it are held to ONE cap), handed to the agent's own budget
 * policy (`RunPolicy.budgets.usd`). The agent decides when to warn and when to contain; each turn is priced by the Brain's one
 * cost rule (`localChat/turnCost.ts`, reported as `ModelUsage.pricedMc`). An uncapped run has no meter.
 */

import type { SpendMeter } from '@builderforce/agent-run';
import { joinRunSpend } from '../runStore/runSpendBudget';
import type { RunLoopContext } from '../runStore/runLoopContext';

export function loopSpendMeter(run: RunLoopContext): SpendMeter | undefined {
  const joined = joinRunSpend(run);
  if (!joined) return undefined;
  const { tree } = joined;
  return {
    spentMc: () => tree.spentMc,
    unpricedCalls: () => tree.unpricedCalls,
    capMc: () => tree.capMc,
    add(pricedMc) {
      if (pricedMc === undefined) tree.unpricedCalls += 1;
      else tree.spentMc += pricedMc;
    },
  };
}
