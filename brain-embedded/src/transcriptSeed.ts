/**
 * The model-visible transcript a run continues from — ONE builder for every host that
 * starts a run on a chat's persisted history (the React hook's send path and trailing-
 * message auto-reply, and a non-React host such as the Chrome extension's run host).
 *
 * The persisted history scoped to the last consolidation marker (a consolidated chat
 * sends its summary as base context instead of the full history), WITHOUT the durable
 * tool/memory STEP rows — those are timeline records, not model turns, and re-sending an
 * orphaned tool message 400s strict vendors. Nor a reply the user STOPPED mid-stream
 * (`stoppedTurn.ts`): that is a record of a model going wrong, kept for the reader —
 * replayed, the next model reads a loop as its own last word and continues it. Assistant
 * turns go back as `replayTextOf` reads them: without the `<think>` blocks they were
 * persisted with, which a model copies as markup instead of calling tools. User turns go
 * back as the model READ them (`attachmentTranscript.ts`): the inlined attachment text it
 * was sent, never the display's `blob:` preview links.
 */
import { replayTextOf } from '@builderforce/agent-loop';
import { advisoryThreadHistoryAdmitted } from '@builderforce/creation-canvas-contract';
import { scopeToConsolidation } from '@seanhogg/builderforce-memory/working';
import { userTurnTextOf } from './attachmentTranscript';
import { isStoppedTurn } from './stoppedTurn';
import type { ChatCompletionMessage } from './streamChatCompletion';
import { isStepMessage, type BrainMessage } from './types';

/**
 * The seed, and the persisted message id behind each seed entry, in
 * order — what lets a run's fold record which persisted messages its note covers
 * (`BrainRunRequest.seedIds`, `runFoldMarker.ts`).
 */
export function transcriptSeedOf(history: BrainMessage[]): { messages: ChatCompletionMessage[]; ids: number[] } {
  const messages: ChatCompletionMessage[] = [];
  const ids: number[] = [];
  // Ask the full history, not the post-consolidation slice: the marker sits on
  // the opening system message, which a later consolidation marker would drop.
  if (!advisoryThreadHistoryAdmitted(history)) return { messages, ids };
  for (const m of scopeToConsolidation(history)) {
    if (isStepMessage(m) || isStoppedTurn(m)) continue;
    if (m.role === 'assistant') {
      const content = replayTextOf(m.content);
      if (!content) continue;
      messages.push({ role: 'assistant', content });
    } else if (m.role === 'user') {
      messages.push({ role: 'user', content: userTurnTextOf(m) });
    } else {
      messages.push({ role: m.role as ChatCompletionMessage['role'], content: m.content });
    }
    ids.push(m.id);
  }
  return { messages, ids };
}
