/**
 * Which user turns START a run — the one rule the conversation's three run doors read: a
 * send, the auto-reply to a trailing turn on load, and Retry.
 *
 * A stop ("Stop the run", "stop", "cancel the task") with nothing running stops nothing.
 * Sent as a turn it STARTED a fresh run, which carried on working: the progress guard's
 * pause asks "Continue with guidance / Stop the run", the question ends the run, and the
 * "Stop the run" answer then arrived at an idle chat (VS Code chat #6). Such a turn is kept
 * as the person's answer and starts nothing. Mid-run, the same words are the Stop button
 * (the editor's `runSteer.ts`, through the same `stopIntent`).
 */

import { isMidTurnMetadata } from '@builderforce/agent-loop';
import { stopIntent } from '@builderforce/run-guards';
import { isConsolidationMarker } from '@seanhogg/builderforce-memory/working';
import { isStepMessage, type BrainMessage } from './types';

/** Does this user turn's text ask for work (true), or only for the work to stop (false)? */
export function startsRun(text: string): boolean {
  return !stopIntent(text);
}

/**
 * The index of the trailing user turn nothing answered — the last message that is not a
 * step row is a USER message that asks for work — or -1. Step rows (the durable
 * LLM/tool/error diagnostics) after it are what a failed run leaves; any assistant reply
 * means it was answered; a stop is answered by stopping.
 */
export function unansweredTurnIndex(messages: readonly BrainMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    // A step, or a compaction note a failed run persisted mid-run, is not an answer.
    if (isStepMessage(message) || isConsolidationMarker(message)) continue;
    return message.role === 'user' && !isMidTurnMetadata(message.metadata) && startsRun(message.content) ? i : -1;
  }
  return -1;
}
