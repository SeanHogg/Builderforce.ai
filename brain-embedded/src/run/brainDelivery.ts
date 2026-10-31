/**
 * What a Brain run still OWES when its model stops calling tools, as the rungs the one agent's stall ladder walks (PRD 35
 * §4 WS4: "stop hook, ship gate, review gate, restated reply" and the delegation recovery). The agent owns the MECHANICS -
 * re-state, count, fall through - and this supplies which rungs hold and the words each says. The gates are the SAME data the
 * Brain's own final-answer hook asks (`runStore/deliveryGates.ts`); the workspace stop hook is `stopHooks.ts`. Pure over the
 * run's facts; nothing here iterates.
 */

import { liftProseAskUser } from '@builderforce/agent-loop';
import type { DeliveryLedger, DeliveryTurn, LadderRung } from '@builderforce/agent-run';
import { askStopHook, MAX_STOP_HOOK_ROUNDS } from '../stopHooks';
import { deliveryGates } from '../runStore/deliveryGates';
import { skipsVerifyStage } from '../runStore/pipelineRoute';
import { nowIso, pushTrace } from '../runStore/runCells';
import type { RunLoopContext } from '../runStore/runLoopContext';
import type { LastTurn } from './loopTurn';

/** The stop hook's counter key; the other rungs are `deliveryGates.ts`'s. */
const STOP_HOOK_RUNG = 'brain.stop_hook';

export function brainDeliveryLedger(run: RunLoopContext, last: LastTurn): DeliveryLedger {
  const { c, req, userRequest, canAskUser } = run;
  const { runTool } = req;
  const note = (label: string, result: string, args: Record<string, unknown> = {}): void => {
    pushTrace(c, { ts: nowIso(), category: 'message', label, args: { step: last.step, ...args }, result });
  };
  return {
    owns: { settle: true },
    // A model that asked its question in prose instead of calling `ask_user` still gets the clickable card.
    accept: (content) => ((canAskUser ? liftProseAskUser(content.trim()) : content.trim()) || 'No response.'),
    async rungs(turn: DeliveryTurn): Promise<readonly LadderRung[]> {
      // A host that cannot run a tool owes nothing: the turn IS the answer.
      if (!runTool) return [];
      // The WORKSPACE's end-of-run directives, asked before the ship gate so whatever they make the run do is part of the change that ships.
      const stopNudge = await askStopHook(req.onStop, { codeChanged: c.codeChanged, touchedFiles: c.touchedFiles, requestText: userRequest, round: run.stopHookRounds });
      // A blocked finish that already wrote files continues on the review model; a QUICK run has no verify stage.
      const verifiable = c.codeChanged && !skipsVerifyStage(run.pipeline);
      const stopHook: LadderRung = {
        id: STOP_HOOK_RUNG, applies: !!stopNudge, restate: Array<string>(MAX_STOP_HOOK_ROUNDS).fill(stopNudge ?? ''), free: MAX_STOP_HOOK_ROUNDS, quote: true, spent: 'fall', entersVerify: verifiable,
        onRestate: () => {
          run.stopHookRounds += 1;
          note('loop.stop_hook', `A workspace stop hook held the run for another turn: ${(stopNudge ?? '').slice(0, 200)}`, { round: run.stopHookRounds });
        },
      };
      const gates: LadderRung[] = deliveryGates(run).map((gate) => ({
        id: gate.id,
        applies: gate.applies(turn.content),
        restate: [gate.nudge()],
        quote: true,
        spent: 'fall',
        entersVerify: gate.entersVerify && verifiable,
        onRestate: () => {
          gate.spend();
          note(gate.trace.label, gate.trace.result, gate.trace.args());
        },
      }));
      return [stopHook, ...gates];
    },
  };
}
