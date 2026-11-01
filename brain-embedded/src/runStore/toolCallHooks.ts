/**
 * The LOOP's hook before a turn's tool calls dispatch: a terminal `ask_user` settles the run,
 * and anything the turn said is kept as its own block. Loop-only - the agent settles a
 * question through `terminalTurn` (`run/brainPlatformTools.ts`, `run/loopTurn.ts`). What a call
 * leaves once it ran is `callPostStep.ts`, shared by both engines.
 */

import type { LoopHooks } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { emit } from './runCells';
import { commitTurnNarration, terminalAskReply } from './turnToolCalls';
import { emitEvermindLearnReconcile } from './runMemory';
import { metaOf, settleReply, type RunLoopContext } from './runLoopContext';

type Hooks = LoopHooks<ChatCompletionMessage>;

/** `beforeToolCalls`: a terminal `ask_user` settles the run; otherwise the turn's
 *  narration is committed before the calls run. */
export function beforeToolCallsHook(run: RunLoopContext): NonNullable<Hooks['beforeToolCalls']> {
  const { c, chatId } = run;
  const { onActivity } = run.req;
  return async (ctx, turn, calls) => {
    const { result, requested } = metaOf(turn);
    // What the turn SAID it would do, judged against what its calls do (`progressGuard.ts`).
    run.progress.noteTurnText(result.text);
    // A terminal `ask_user` settles the run on the question (`turnToolCalls.ts`).
    const reply = terminalAskReply(run, result, calls, ctx.step);
    if (reply) {
      const assistantMsg = await settleReply(run, reply, result, requested);
      emit(c);
      emitEvermindLearnReconcile(run, assistantMsg, reply);
      onActivity?.(chatId);
      return { action: 'stop', ok: true, output: reply };
    }
    await commitTurnNarration(run, result, requested);
    return undefined;
  };
}
