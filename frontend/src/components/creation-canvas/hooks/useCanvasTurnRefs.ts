import { useRef } from 'react';

/**
 * The per-turn records the Brain's tools read MID-TURN. Refs rather than state: they are
 * read inside tool handlers the loop calls from closures that must see the CURRENT value,
 * and a re-render per tool call would rebuild the whole action list underneath the loop
 * that is walking it.
 *
 *  - `inFlightUseCaseIdRef`: the executive contract THIS turn is running, read off the
 *    prompt when the run starts — what lets `canvas_prepare_executive_use_case` recover
 *    from a model that mistypes the one argument it was given.
 *  - `turnToolCallsRef`: every tool this turn actually CALLED, by advertised name. Cleared
 *    at the start of every turn beside the trace. It is what makes
 *    `ExecutiveCanvasWorkflow.requiredTools` an enforcement rather than a sentence.
 *  - `turnUnansweredRef`: set when the string the turn runner returned is a RUNTIME NOTICE
 *    rather than an answer Brain produced — read once when the turn settles, so the notice
 *    is shown without entering the transcript the next turn is built from.
 */
export function useCanvasTurnRefs() {
  const inFlightUseCaseIdRef = useRef<string | null>(null);
  const turnToolCallsRef = useRef<Set<string>>(new Set());
  const turnUnansweredRef = useRef<{ reason: string; detail?: string } | null>(null);
  return { inFlightUseCaseIdRef, turnToolCallsRef, turnUnansweredRef };
}
