/**
 * Adopting an answer the run did NOT get from a model — the ONE way a turn-0
 * short-circuit settles a run: the reply joins the transcript, is persisted, and a
 * `recall` step records that the LLM was skipped and what answered instead.
 *
 * Two short-circuits use it: the host's deterministic answer (`answerWithoutModel` —
 * "where is X defined?" from the symbol index), asked first, and the memory-first answer
 * (Q&A cache / Evermind, `runMemory.ts`).
 */

import { replayTextOf } from '@builderforce/agent-loop';
import type { RunCell } from './runCell';
import { emit, nowIso, pushTrace, recordAppended } from './runCells';
import { canonicalTurnText } from './turnPersistence';
import { latestUserText } from './convoText';
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

/**
 * The host's deterministic answer (`req.answerWithoutModel`), adopted when it has one.
 * Not gated on memory replay: it is computed from the workspace NOW, not replayed from an
 * earlier answer, so it is as valid on a follow-up turn as on the first. Best-effort.
 */
export async function answerDeterministically(chatId: number, c: RunCell, req: BrainRunRequest): Promise<boolean> {
  if (!req.answerWithoutModel || c.abort?.signal.aborted) return false;
  const query = latestUserText(c.transcript);
  if (!query) return false;
  let text: string | undefined;
  try {
    text = await req.answerWithoutModel(query);
  } catch {
    text = undefined;
  }
  if (!text) return false;
  return adoptAnswerWithoutModel(chatId, c, req, text, {
    label: 'symbols.answer',
    args: { query },
    result: { source: 'symbol-index' },
  });
}
