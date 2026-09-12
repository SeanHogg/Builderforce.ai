'use client';

import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { assessmentGate, type AssessmentGate } from './assessment';

const OPEN: AssessmentGate = assessmentGate('open');

/**
 * The assistant gate every composer in the shell obeys.
 *
 * `assessmentGate` is THE evaluator (see `assessment.ts`); this is only how a
 * composer reaches the answer for the board on stage without being handed it. The
 * board publishes its live mode to the shell, the shell runs it through the
 * evaluator once, and the canvas prompt, the Brain panel and any other composer
 * read the same verdict — one rule, not one per surface with a hole in each.
 *
 * Open outside a shell with a stage (the marketing hero, an embed, a test).
 */
export function useAssistantGate(): AssessmentGate {
  return useOptionalActiveCanvas()?.assistantGate ?? OPEN;
}
