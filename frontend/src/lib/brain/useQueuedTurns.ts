'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Turns the user typed while a run was still in flight.
 *
 * THE RULE THIS ENCODES: a composer never blocks typing because the agent is
 * busy. Disabling the input while a turn streams is what made a long run feel
 * like a hang — the user had a follow-up ready, a correction to make, or wanted
 * to queue the next step, and the product's answer was a greyed-out box.
 *
 * Instead the turn is HELD and sent on the run's falling edge, one per completed
 * run, so the transcript stays ordered and no two turns race the same chat.
 *
 * Shared by every surface that has a composer over a single-flight run (the
 * Brain panel, the Creation Canvas): the queueing rule, the flush edge and the
 * "queued turns belong to the conversation they were typed in" reset are ONE
 * implementation, not one per host.
 */
export interface QueuedTurns {
  /** How many turns are waiting. Render with `<QueuedTurnsNotice />`. */
  count: number;
  /**
   * Offer a turn to the queue. Returns true when it was HELD (a run is in
   * flight and the caller must not send), false when the caller should send it
   * now. Written this way so the host keeps ownership of how it sends.
   */
  submit: (text: string) => boolean;
  /** Drop everything waiting — a stopped run, or a switched conversation. */
  clear: () => void;
}

export function useQueuedTurns({ running, send, resetKey }: {
  /** True while a turn is in flight on this conversation. */
  running: boolean;
  /** Send one held turn. Called on the running→idle edge, newest closure. */
  send: (text: string) => void;
  /** Queued turns are discarded when this changes (e.g. the active chat id). */
  resetKey?: string | number | null;
}): QueuedTurns {
  const [queued, setQueued] = useState<string[]>([]);
  // The flush effect must call the CURRENT send closure without re-running (and
  // re-sending) every time the host re-renders with a new one.
  const sendRef = useRef(send);
  // eslint-disable-next-line react-hooks/refs
  sendRef.current = send;
  const runningRef = useRef(running);

  const submit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (!runningRef.current) return false;
    setQueued((current) => [...current, trimmed]);
    return true;
  }, []);
  // Read through a ref so `submit`'s identity survives a run starting: hosts
  // wrap it in their own useCallback, and a changing identity there re-creates
  // the composer's submit handler on every token.
  // eslint-disable-next-line react-hooks/refs
  runningRef.current = running;

  const clear = useCallback(() => setQueued((current) => (current.length ? [] : current)), []);

  // Flush exactly one held turn per completed run, on the running→idle edge.
  const prevRunning = useRef(running);
  useEffect(() => {
    const was = prevRunning.current;
    prevRunning.current = running;
    if (!was || running || queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    if (next) sendRef.current(next);
  }, [running, queued]);

  // Queued text belongs to the conversation it was typed in, never the one
  // switched to.
  useEffect(() => { setQueued([]); }, [resetKey]);

  return { count: queued.length, submit, clear };
}
