/**
 * What a turn that CALLS tools settles before any call dispatches: a terminal `ask_user` ends the run as its reply, and
 * otherwise the turn's visible narration is committed as its own permanent block. Shared by the Brain's loop
 * (`toolCallHooks.ts`) and the agent's model port (`run/loopTurn.ts`) so a question is decided one way on both.
 */

import { ASK_USER_TOOL, askUserBlock } from '@builderforce/agent-loop';
import type { StreamChatResult } from '../streamChatCompletion';
import { runLeftDelegationUndone } from './earlyDelegation';
import { emit, nowIso, pushTrace } from './runCells';
import { persistMidTurnText } from './turnPersistence';
import type { RunLoopContext } from './runLoopContext';

/** A turn's call, as both engines see it. */
export interface TurnCall {
  name: string;
  args: Record<string, unknown>;
  malformed: boolean;
}

/**
 * `ask_user` is TERMINAL: the agent is blocked on the user's decision, so the run settles on a reply that carries any lead-in
 * prose plus the canonical ```ask-user block the transcript renders as a clickable card. Malformed args fall through to the
 * prose path, so a question is never swallowed by its own formatting. A run that was asked for SUB-AGENTS and asks how to
 * proceed instead is not settled: the call dispatches and `beforeDispatch` answers it with the delegation contract (once).
 * Returns the reply, or undefined when the turn does not end the run.
 */
export function terminalAskReply(run: RunLoopContext, result: StreamChatResult, calls: readonly TurnCall[], step: number): string | undefined {
  const askCall = calls.find((tc) => tc.name === ASK_USER_TOOL);
  if (!askCall) return undefined;
  if (run.req.runTool && !run.delegationRecoveryUsed && runLeftDelegationUndone(run)) {
    run.delegationRecoveryUsed = true;
    run.redirectAskToDelegation = true;
    pushTrace(run.c, {
      ts: nowIso(),
      category: 'message',
      label: 'loop.recover_undelegated_request',
      args: { step, via: 'ask_user' },
      result: 'The user asked for sub-agents and the run asked how to proceed without starting one — answered with the local delegation contract instead of settling the question.',
    });
    return undefined;
  }
  let block: string | null = null;
  try { block = askCall.malformed ? null : askUserBlock(askCall.args); } catch { block = null; }
  const lead = result.text.trim();
  const reply = block ? (lead ? `${lead}\n\n${block}` : block) : lead;
  // A bare malformed call with no prose: let it dispatch, where `beforeDispatch` answers with the corrective result.
  return reply || undefined;
}

/**
 * Commit this turn's visible narration as its OWN permanent message block before the streaming buffer is cleared for the next
 * turn. Without this the narration only lived in the transient `streamingText` bubble, and the next turn's stream reused that
 * bubble - erasing what the user just read.
 */
export async function commitTurnNarration(run: RunLoopContext, result: StreamChatResult, requested: string | undefined): Promise<void> {
  await persistMidTurnText(run.chatId, run.c, run.req.persistence, result, requested);
  run.c.streamingText = '';
  emit(run.c);
}
