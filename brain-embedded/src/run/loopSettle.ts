/**
 * What happens AFTER the one agent returns for a Brain run (PRD 35 §4 WS4 "the adapter tail"): the settled reply, the
 * Evermind learn and reconcile steps, `onActivity`, and a failure's verdict. The agent decided how the run ended; this puts
 * that on the chat and the cell, the way the Brain's own loop's tail does (the SAME `settleReply` and
 * `emitEvermindLearnReconcile`). A failed outcome re-throws the transport's own error so `chatErrorAction` still reads it.
 */

import { RUN_CANCELLED_REASON, type RunOutcome } from '@builderforce/agent-run';
import type { StreamChatResult } from '../streamChatCompletion';
import { emit, recordRunFailure } from '../runStore/runCells';
import { emitEvermindLearnReconcile } from '../runStore/runMemory';
import { settleReply, type RunLoopContext } from '../runStore/runLoopContext';
import type { LastTurn } from './loopTurn';

export async function settleBrainRun(run: RunLoopContext, outcome: RunOutcome, last: LastTurn): Promise<void> {
  const { c, chatId, req } = run;
  if (outcome.kind === 'yielded') return;
  if (outcome.kind === 'failed') {
    // A Stop settles quietly; a port's exception is re-thrown as it was thrown.
    if (outcome.reason === RUN_CANCELLED_REASON || c.abort?.signal.aborted) return;
    if (outcome.cause !== undefined) throw outcome.cause;
    if (outcome.exhausted) {
      c.streamingText = '';
      recordRunFailure(c, 'agent.loop', outcome.reason);
      c.error = `The assistant's last tool calls all failed and it gave no answer. Read the failing steps above, then try again with what they ask for.`;
      emit(c);
      return;
    }
    throw new Error(outcome.reason);
  }
  const text = outcome.kind === 'paused' ? outcome.question : outcome.output;
  if (!text.trim()) return;
  const result = last.result ?? ({ text, toolCalls: [] } as unknown as StreamChatResult);
  const assistantMsg = await settleReply(run, text, result, last.requested);
  emit(c);
  emitEvermindLearnReconcile(run, assistantMsg, text);
  req.onActivity?.(chatId);
}
