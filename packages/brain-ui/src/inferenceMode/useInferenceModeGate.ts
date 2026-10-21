/**
 * THE first-run gate — "a turn sent before the person chose where models run is held
 * behind the question and sent the moment they answer (the mode applies first)". One
 * hook, so every way a turn starts passes the same gate: the composer's Send
 * (`BrainComposer`) and a host's programmatic send (the landing page's one-shot prompt in
 * the guest panel) — a host that owns the gate hands it to the composer as `modeGate`, so
 * the question shows in the composer either way.
 *
 * `request(send)` runs `send` at once when no choice is needed, else holds it and asks.
 * `choose(mode)` applies the mode, then runs the held send. A send still held when the
 * question stops being needed (the person chose in the `/` menu instead) is sent then.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InferenceMode } from '@seanhogg/builderforce-brain-embedded';
import type { PromptOptionsInferenceMode } from './InferenceModeControl';

export interface InferenceModeGate {
  /** The question is showing (a send is held behind it). */
  asking: boolean;
  /** Run `send` now, or hold it behind the question. True = it ran now. */
  request: (send: () => void) => boolean;
  /** The person's answer: apply the mode, then run the held send. */
  choose: (mode: InferenceMode) => void;
}

export function useInferenceModeGate(inferenceMode: PromptOptionsInferenceMode | undefined): InferenceModeGate {
  const needsChoice = !!inferenceMode?.needsChoice;
  const held = useRef<(() => void) | null>(null);
  const [holding, setHolding] = useState(false);
  const onChange = inferenceMode?.onChange;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const needsRef = useRef(needsChoice);
  needsRef.current = needsChoice;

  const request = useCallback((send: () => void): boolean => {
    if (!needsRef.current) { send(); return true; }
    held.current = send;
    setHolding(true);
    return false;
  }, []);

  const choose = useCallback((mode: InferenceMode) => {
    const send = held.current;
    held.current = null;
    setHolding(false);
    void Promise.resolve(onChangeRef.current?.(mode)).finally(() => send?.());
  }, []);

  // Chosen elsewhere (the `/` menu, another tab) while a send was held: send it now.
  useEffect(() => {
    if (needsChoice || !held.current) return;
    const send = held.current;
    held.current = null;
    setHolding(false);
    send();
  }, [needsChoice]);

  return { asking: holding && needsChoice, request, choose };
}
