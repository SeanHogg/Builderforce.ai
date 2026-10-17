/** The canvas composer's Effort and Thinking — the `/` Work panel's run shaping. */
import { useMemo, useState } from 'react';
import type { BrainEffort } from '@/lib/brain';
import type { CanvasRunShaping } from '@/lib/canvasAiTurnBudget';

/**
 * Effort and Thinking for this canvas session — the same two rows the Brain panel's
 * `/` menu offers, so the canvas prompt is not the one composer without them.
 *
 * The defaults are QUICK + Thinking ON on purpose: that is exactly the request the
 * canvas sent before the rows existed (a 3,200-token ceiling and `reasoning: low`), so
 * nobody's canvas turns change until they move a control — and the menu now says what
 * that request costs instead of hiding it.
 */
export function useCanvasRunShaping() {
  const [effort, setEffort] = useState<BrainEffort>('quick');
  const [thinking, setThinking] = useState(true);
  const runShaping = useMemo<CanvasRunShaping>(() => ({ effort, thinking }), [effort, thinking]);
  return { runShaping, effort, setEffort, thinking, setThinking };
}
