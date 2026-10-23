/**
 * THE first-run gate — "a turn sent before the person chose where models run is held
 * behind the question and sent the moment they answer (the mode applies first)". One
 * hook, so every way a turn starts passes the same gate: the composer's Send
 * (`BrainComposer`) and a host's programmatic send (the landing page's one-shot prompt in
 * the guest panel) — a host that owns the gate hands it to the composer as `modeGate`, so
 * the question shows in the composer either way.
 *
 * `request(send)` runs `send` at once when no choice is needed, else holds it and asks.
 * `choose(mode)` applies the mode, then runs the held sends. A send still held when the
 * question stops being needed (the person chose in the `/` menu instead) is sent then.
 *
 * Every held send is KEPT, in order: the landing prompt held behind the question and a
 * second Send pressed while it shows are both the person's — replacing the first with the
 * second silently dropped a turn. And once the person has answered, the gate is open for
 * the rest of this mount at once, not from the host's next render: a held send that
 * itself passes the gate again (a host door that gates, behind a composer that gates)
 * must run, never be held a second time behind a question that was already answered.
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
  const held = useRef<Array<() => void>>([]);
  const [holding, setHolding] = useState(false);
  const onChange = inferenceMode?.onChange;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** Answered on this mount — the gate stays open even before the host re-renders. */
  const answered = useRef(false);
  const needsRef = useRef(needsChoice);
  needsRef.current = needsChoice && !answered.current;

  /** Take every held send, in the order it was requested, and clear the hold. */
  const release = useCallback((): Array<() => void> => {
    const sends = held.current;
    held.current = [];
    setHolding(false);
    return sends;
  }, []);

  const request = useCallback((send: () => void): boolean => {
    if (!needsRef.current) { send(); return true; }
    held.current = [...held.current, send];
    setHolding(true);
    return false;
  }, []);

  const choose = useCallback((mode: InferenceMode) => {
    answered.current = true;
    needsRef.current = false;
    const sends = release();
    // Sent whether or not the mode's side effects settled cleanly — the choice is stored
    // first, and a held turn that then cannot run reports its own failure (never a hang).
    const run = () => { for (const send of sends) send(); };
    void Promise.resolve(onChangeRef.current?.(mode)).then(run, run);
  }, [release]);

  // Chosen elsewhere (the `/` menu, another tab) while a send was held: send it now.
  useEffect(() => {
    if (needsChoice || held.current.length === 0) return;
    for (const send of release()) send();
  }, [needsChoice, release]);

  return { asking: holding && needsChoice && !answered.current, request, choose };
}
