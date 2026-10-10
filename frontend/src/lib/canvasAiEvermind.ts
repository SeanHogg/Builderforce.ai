import {
  countReconciledMemories,
  type BrainTraceEvent,
  type EvermindRecallResult,
} from '@seanhogg/builderforce-brain-embedded';

/**
 * Evermind on a Creation Canvas turn: recall before the first request, learn from the
 * answer the turn settles on. Split out of `creationCanvasAi.ts`; both halves are
 * best-effort and can never fail the turn.
 */
export interface CanvasEvermindPort {
  recall: (query: string) => Promise<EvermindRecallResult | null>;
  learn: (answer: string, prompt: string) => Promise<{ ok: boolean; queued?: number }>;
}

type TraceSink = ((event: BrainTraceEvent) => void) | undefined;

/** Recall memories for `prompt`, tracing a seeded hit. Null when nothing is available. */
export async function recallCanvasMemory(
  evermind: CanvasEvermindPort | undefined,
  prompt: string,
  onTrace: TraceSink,
): Promise<EvermindRecallResult | null> {
  if (!evermind) return null;
  let recalled: EvermindRecallResult | null;
  try { recalled = await evermind.recall(prompt); } catch { recalled = null; }
  if (recalled?.seeded && recalled.items.length) onTrace?.({
    ts: new Date().toISOString(), category: 'recall', label: 'evermind.recall',
    args: { query: prompt, version: recalled.version },
    result: { count: recalled.items.length, version: recalled.version, mode: recalled.mode, items: recalled.items },
  });
  return recalled;
}

/**
 * Hand a settled answer to Evermind's learn path and trace the outcome. Skips short or
 * empty answers and turns with no recall; a frozen or unseeded recall is traced as a skip.
 */
export async function learnFromCanvasAnswer(
  evermind: CanvasEvermindPort | undefined,
  recalled: EvermindRecallResult | null,
  answer: string,
  prompt: string,
  onTrace: TraceSink,
): Promise<void> {
  const text = answer.trim();
  if (!evermind || !text || text.length < 40 || !recalled) return;
  if (!recalled.seeded || recalled.mode === 'offline-frozen') {
    onTrace?.({ ts: new Date().toISOString(), category: 'learn', label: 'evermind.learn', result: { version: recalled.version, skipped: true, reason: recalled.seeded ? 'frozen' : 'not-seeded' } });
    return;
  }
  try {
    const learned = await evermind.learn(text, prompt);
    if (learned.ok) {
      onTrace?.({ ts: new Date().toISOString(), category: 'learn', label: 'evermind.learn', result: { version: recalled.version, queued: learned.queued ?? true } });
      const reconciled = countReconciledMemories(recalled.items, text);
      if (reconciled) onTrace?.({ ts: new Date().toISOString(), category: 'reconcile', label: 'evermind.reconcile', result: { count: reconciled, version: recalled.version } });
    }
  } catch { /* Evermind learning is best-effort and must not fail the canvas turn. */ }
}
