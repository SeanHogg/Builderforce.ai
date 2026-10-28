/**
 * Adopting an answer the run did NOT get from a model — the ONE way a turn-0
 * short-circuit settles a run: the reply joins the transcript, is persisted, and a
 * `recall` step records that the LLM was skipped and what answered instead.
 *
 * Two short-circuits use it: the PreFetch gate's ANSWER actions (`prefetchGate.ts` —
 * "where is X defined?" from the symbol index, and every registry row after it), asked
 * first, and the memory-first answer (Q&A cache / Evermind, `runMemory.ts`).
 */

import { replayTextOf } from '@builderforce/agent-loop';
import type { RunCell } from './runCell';
import { emit, nowIso, pushTrace, recordAppended } from './runCells';
import { canonicalTurnText } from './turnPersistence';
import type { BrainRunRequest } from './runTypes';

/** The trace step recorded for an adopted answer (category `recall`, `skippedLlm: true`). */
export interface AdoptedAnswerStep {
  label: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

/** Settle the run on `text`. False (nothing adopted) when the text is empty. */
export async function adoptAnswerWithoutModel(
  chatId: number,
  c: RunCell,
  req: BrainRunRequest,
  text: string,
  step: AdoptedAnswerStep,
): Promise<boolean> {
  const finalText = canonicalTurnText(text);
  if (!finalText) return false;
  c.transcript.push({ role: 'assistant', content: replayTextOf(finalText) });
  const [assistantMsg] = await req.persistence.sendMessages(chatId, [{ role: 'assistant', content: finalText }]);
  c.streamingText = '';
  recordAppended(c, assistantMsg);
  pushTrace(c, { ts: nowIso(), category: 'recall', label: step.label, args: step.args, result: { ...step.result, skippedLlm: true } });
  emit(c);
  req.onActivity?.(chatId);
  return true;
}
