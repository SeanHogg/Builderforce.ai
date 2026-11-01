/**
 * What happens AFTER the one agent returns for a Brain run (PRD 35 §4 WS4 "the adapter tail"): the settled reply, the
 * Evermind learn and reconcile steps, `onActivity`, and a failure's verdict. The agent decided how the run ended; this puts
 * that on the chat and the cell, the way the Brain's own loop's tail does (the SAME `settleReply` and
 * `emitEvermindLearnReconcile`). A failed outcome re-throws the error the stream threw - the very object, its `status`, `unlock`,
 * `reason`, `requiredPlan`, `feature` and `capability` intact and its message unprefixed (`LastTurn.error`) - so
 * `chatErrorAction` reads what it always read. A run its USD cap stopped does not settle as a reply (`persistBudgetStop`).
 */

import { DEFAULT_TOOL_FAILURE_STREAK } from '@builderforce/agent-loop';
import { RUN_CANCELLED_REASON, type RunOutcome } from '@builderforce/agent-run';
import type { StreamChatResult } from '../streamChatCompletion';
import { emit } from '../runStore/runCells';
import { closeAfterFailureStreak } from '../runStore/failureClose';
import { emitEvermindLearnReconcile } from '../runStore/runMemory';
import { settleReply, type RunLoopContext } from '../runStore/runLoopContext';
import { persistBudgetStop } from '../runStore/runSpendBudget';
import type { LastTurn } from './loopTurn';

export async function settleBrainRun(run: RunLoopContext, outcome: RunOutcome, last: LastTurn): Promise<void> {
  const { c, chatId, req } = run;
  // An answer the agent never went on with is not part of the run.
  last.pending = undefined;
  if (outcome.kind === 'yielded') return;
  if (outcome.kind === 'failed') {
    // A Stop settles quietly; a port's exception is re-thrown as it was thrown.
    if (outcome.reason === RUN_CANCELLED_REASON || c.abort?.signal.aborted) return;
    if (outcome.cause !== undefined) throw outcome.cause;
    // The completion that failed the run: the error as the stream threw it, never a new one made from its message.
    if (last.error !== undefined) throw last.error;
    // The breaker stopped the run: the forced tools-free closing answer is the Brain's own, shared with its loop (`failureClose.ts`).
    if (outcome.exhausted) return closeAfterFailureStreak(run, DEFAULT_TOOL_FAILURE_STREAK, outcome.state.step);
    throw new Error(outcome.reason);
  }
  const text = outcome.kind === 'paused' ? outcome.question : outcome.output;
  if (!text.trim()) return;
  // The run's USD cap stopped it: its reply says why and is saved as it is - no provenance chip, no Evermind learn (`runSpendBudget.ts`).
  if (last.contained !== undefined && text === last.contained) return persistBudgetStop(run, text);
  const result = last.result ?? ({ text, toolCalls: [] } as unknown as StreamChatResult);
  const assistantMsg = await settleReply(run, text, result, last.requested);
  emit(c);
  emitEvermindLearnReconcile(run, assistantMsg, text);
  req.onActivity?.(chatId);
}
