/**
 * The Brain's say over a turn's menu (`PlatformTools.turn`, PRD 35 §4 WS4). A turn a progress rule FORCED — the plan budget's hand-off
 * turn, the change budget, a run circling its read cache, A3's escalation or finish — is the AGENT's decision
 * (`@builderforce/agent-run` `policy/guards/forced`, bound by `brainProgressPorts.ts`): it arrives as `TurnEnv.forced` and is advertised
 * as it is. What stays here is the Brain's own: the ROUTER rides every turn the role's cap trimmed, so the tools that missed the cut
 * stay REACHABLE.
 */

import { roleToolLimit, type TurnEnv, type TurnMenu } from '@builderforce/agent-run';
import type { ToolSchema } from '@builderforce/agent-tools';
import type { BrainToolSpec } from '../streamChatCompletion';
import { routerToolSpecs } from '../toolRouter';
import { nowIso, pushTrace } from '../runStore/runCells';
import type { BrainRunContext } from '../runStore/brainRunContext';

export async function brainTurnMenu(run: BrainRunContext, env: TurnEnv, catalogSize: number): Promise<TurnMenu | void> {
  // A forced turn (a finishing run's record or final turn, a hand-off, a change-only turn) is advertised as the agent decided it:
  // its brief is on the menu's tail, and a finishing run's no-tool turn is marked FINAL, so the kernel never judges it as a stall and
  // no delivery rung sends it back to do work it has no tools for (VS Code chat #128305).
  if (env.forced) return env.forced;
  // The agent's selection: once the run is coding, the plan is handed off and `hand_off` is gone from the menu, so a coder can never
  // re-plan the work it was just given.
  const selected = (await env.select()) as unknown as BrainToolSpec[];
  // The ROUTER rides along whenever selection trimmed something, so the tools that missed the cut stay REACHABLE. A catalog at or under
  // the limit is never trimmed (the agent's `selectToolsForTurn`): `hand_off` leaving the menu is not a trim. The limit is the turn's role's
  // (a code or verify turn is capped far below the wide default), so the router rides every turn the cap trimmed.
  if (catalogSize > roleToolLimit(run.policy.phase)) {
    pushTrace(run.c, {
      ts: nowIso(),
      category: 'message',
      label: 'tools.selected',
      args: { step: env.step },
      result: `${selected.length} of ${catalogSize} tools advertised this turn (nothing trimmed — the full catalog was offered; ${run.usedTools.size} pinned from earlier calls)`,
    });
    return { tools: [...(selected as unknown as ToolSchema[]), ...(routerToolSpecs(catalogSize) as unknown as ToolSchema[])] };
  }
  return { tools: selected as unknown as ToolSchema[] };
}
