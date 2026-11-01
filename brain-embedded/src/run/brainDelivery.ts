/**
 * What a Brain run still OWES when its model stops calling tools, as the rungs the one agent's stall ladder walks (PRD 35
 * §4 WS4: "stop hook, ship gate, review gate, restated reply" and the delegation recovery). The agent owns the MECHANICS -
 * re-state, count, fall through - and this supplies which rungs hold and the words each says. The gates are the SAME data the
 * Brain's own final-answer hook asks (`runStore/deliveryGates.ts`); the workspace stop hook is `stopHooks.ts`. Pure over the
 * run's facts; nothing here iterates.
 */

import { liftProseAskUser, replayTextOf } from '@builderforce/agent-loop';
import type { DeliveryLedger, DeliveryTurn, LadderRung } from '@builderforce/agent-run';
import { askStopHook, MAX_STOP_HOOK_ROUNDS } from '../stopHooks';
import { deliveryGates } from '../runStore/deliveryGates';
import { skipsVerifyStage } from '../runStore/pipelineRoute';
import { emit, nowIso, pushTrace } from '../runStore/runCells';
import { persistReply, type RunLoopContext } from '../runStore/runLoopContext';
import { persistMidTurnText } from '../runStore/turnPersistence';
import type { LastTurn } from './loopTurn';

/** The stop hook's counter key; the other rungs are `deliveryGates.ts`'s. */
const STOP_HOOK_RUNG = 'brain.stop_hook';

export function brainDeliveryLedger(run: RunLoopContext, last: LastTurn): DeliveryLedger {
  const { c, req, userRequest, canAskUser } = run;
  const { runTool } = req;
  const note = (label: string, result: string, args: Record<string, unknown> = {}): void => {
    pushTrace(c, { ts: nowIso(), category: 'message', label, args: { step: last.step, ...args }, result });
  };
  // A model that asked its question in prose instead of calling `ask_user` still gets the clickable card.
  // The agent holds a turn as it is replayed (the reply, else its reasoning as plain text); the settled message is the turn as the model
  // wrote it, reasoning block and all, which the person can open (`canonicalTurnText`).
  const asWritten = (content: string): string => (last.result && replayTextOf(last.result.text).trim() === content.trim() ? last.result.text : content);
  const accept = (content: string): string => {
    const full = asWritten(content).trim();
    return (canAskUser ? liftProseAskUser(full) : full) || 'No response.';
  };
  return {
    // The closing answer after a failure streak is the Brain's own (`runStore/failureClose.ts`, run by the adapter tail). A host that
    // cannot run a tool judges no stall at all (the rungs are none): the turn IS the answer.
    owns: { settle: true, synthesis: true, ...(runTool ? {} : { narration: true as const }) },
    // The Brain's stall order and wording (`runStore/finalAnswerHook.ts`): a narrating turn is re-prompted before any rung, a model that
    // spent its budget is failed over (reading the nudge alone) or stopped only once every rung is clear, the rungs' directives are the
    // person's rows, and the stall is judged against the menu the turn advertised.
    stall: { narrationFirst: true, steersFirst: true, nudgeAs: 'user', failoverNudgeOnly: true, menu: true, quoteEmpty: true, runWideBudget: true },
    // The stall judgement and the gates read the model's own words, reasoning included (`finalAnswerHook.ts` reads `result.text`).
    judged: (content) => last.result?.text ?? content,
    // A turn sent back keeps what the person watched stream in: as its own block, or - a model that stalled out and was handed
    // over - as the reply it was (`finalAnswerHook.ts`'s `requeueWithNudge` and its failover).
    async sentBack({ kept }) {
      const result = last.result;
      if (!result) return;
      if (kept === 'reply') await persistReply(run, accept(result.text), result, last.requested);
      else await persistMidTurnText(run.chatId, c, run.req.persistence, result, last.requested);
      c.streamingText = '';
      emit(c);
    },
    accept,
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
