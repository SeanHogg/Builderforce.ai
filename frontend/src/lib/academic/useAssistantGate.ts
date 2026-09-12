import { useMemo } from 'react';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { assessmentGate, type AssessmentGate } from './assessment';

/**
 * The assistant gate every composer in the shell obeys.
 *
 * `assessmentGate` is THE evaluator (see `assessment.ts`); this is only how a
 * composer reaches the answer for the board on stage without being handed it. The
 * board publishes its live mode to the shell, and the canvas prompt, the Brain panel
 * and any other composer run it through the same evaluator here — one rule, not one
 * per surface with a hole in each. The shell holds only the MODE, so the evaluator
 * is loaded by the composers that need it rather than on every route's first paint.
 *
 * Open outside a shell with a stage (the marketing hero, an embed, a test).
 */
export function useAssistantGate(): AssessmentGate {
  const mode = useOptionalActiveCanvas()?.assessmentMode ?? 'open';
  return useMemo(() => assessmentGate(mode), [mode]);
}
