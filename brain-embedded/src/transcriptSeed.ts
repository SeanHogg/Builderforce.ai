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
 * persisted with, which a model copies as markup instead of calling tools.
 */
import { replayTextOf } from '@builderforce/agent-loop';
import { scopeToConsolidation } from './consolidation';
import { isStoppedTurn } from './stoppedTurn';
import type { ChatCompletionMessage } from './streamChatCompletion';
import { isStepMessage, type BrainMessage } from './types';

export function transcriptSeedFrom(history: BrainMessage[]): ChatCompletionMessage[] {
  return scopeToConsolidation(history)
    .filter((m) => !isStepMessage(m) && !isStoppedTurn(m))
    .flatMap((m): ChatCompletionMessage[] => {
      if (m.role !== 'assistant') return [{ role: m.role as ChatCompletionMessage['role'], content: m.content }];
      const content = replayTextOf(m.content);
      return content ? [{ role: 'assistant', content }] : [];
    });
}
