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
 * Every host that mounts a composer over a single-flight run (the web Brain panel,
 * the Creation Canvas, the VS Code chat, Rovr) needs the same queueing rule, flush
 * edge and "queued turns belong to the conversation they were typed in" reset. This
 * is the ONLY turn queue — a host whose turn carries more than text (VS Code's
 * addressed recipient) queues a richer `T`, it does not fork the rule.
 *
 * Lives in the core (moved from brain-ui, which re-exports it unchanged) because
 * `useChatTurns` — the ONE send/stop/queue door — owns it, and the core must not
 * depend on the UI package.
 */
export interface QueuedItem<T> {
  /** Stable per held turn, so a host can render it and let the user remove it. */
  readonly id: number;
  readonly value: T;
}

export interface QueuedTurns<T = string> {
  /** The held turns, oldest first. */
  items: readonly QueuedItem<T>[];
  /** How many turns are waiting. */
  count: number;
  /**
   * Offer a turn to the queue. Returns true when it was HELD (a run is in
   * flight and the caller must not send), false when the caller should send it
   * now. Written this way so the host keeps ownership of how it sends.
   */
  submit: (value: T) => boolean;
  /** Drop one held turn (the user removed it, or steered it into the run). */
  remove: (id: number) => void;
  /** Drop everything waiting — a stopped run, or a switched conversation. */
  clear: () => void;
}

export interface QueuedTurnsOptions<T> {
  /** True while a turn is in flight on this conversation. */
  running: boolean;
  /** Send one held turn. Called on the running→idle edge, newest closure. */
  send: (value: T) => void;
  /** Queued turns are discarded when this changes (e.g. the active chat id). */
  resetKey?: string | number | null;
  /**
   * The text a non-string turn carries, for the blank check. String turns are
   * trimmed and checked directly; omit this for them.
   */
  textOf?: (value: T) => string;
  /**
   * A turn that goes BEFORE the held ones when a run completes — e.g. direction steered into
   * the run after its last drain, which nothing else would ever deliver. Asked once per
   * completed run, on the falling edge; a turn it returns is sent INSTEAD of one held turn
   * (held turns keep their one-per-run rhythm and follow on the next edge). Nothing ⇒ the
   * held queue flushes as usual.
   */
  lead?: () => T | undefined;
}

export function useQueuedTurns<T = string>({ running, send, resetKey = null, textOf, lead }: QueuedTurnsOptions<T>): QueuedTurns<T> {
  const [queued, setQueued] = useState<QueuedItem<T>[]>([]);
  const nextId = useRef(0);
  // The flush effect must call the CURRENT send closure without re-running (and
  // re-sending) every time the host re-renders with a new one.
  const sendRef = useRef(send);
  // eslint-disable-next-line react-hooks/refs
  sendRef.current = send;
  const textOfRef = useRef(textOf);
  // eslint-disable-next-line react-hooks/refs
  textOfRef.current = textOf;
  const leadRef = useRef(lead);
  // eslint-disable-next-line react-hooks/refs
  leadRef.current = lead;
  const runningRef = useRef(running);

  const submit = useCallback((value: T) => {
    const text = typeof value === 'string' ? value.trim() : (textOfRef.current?.(value) ?? '').trim();
    if (!text) return false;
    if (!runningRef.current) return false;
    const held = (typeof value === 'string' ? text : value) as T;
    setQueued((current) => [...current, { id: (nextId.current += 1), value: held }]);
    return true;
  }, []);
  // Read through a ref so `submit`'s identity survives a run starting: hosts
  // wrap it in their own useCallback, and a changing identity there re-creates
  // the composer's submit handler on every token.
  // eslint-disable-next-line react-hooks/refs
  runningRef.current = running;

  const remove = useCallback((id: number) => setQueued((current) => current.filter((item) => item.id !== id)), []);
  const clear = useCallback(() => setQueued((current) => (current.length ? [] : current)), []);

  // Flush exactly one held turn per completed run, on the running→idle edge — and
  // only when that edge happened on the SAME conversation. `running` is per
  // conversation, so switching away from a running chat drops it true→false in the
  // same render the key changes; flushing then would send the old chat's turn into
  // the one just switched to.
  const prev = useRef({ key: resetKey, running });
  useEffect(() => {
    const was = prev.current;
    prev.current = { key: resetKey, running };
    if (was.key !== resetKey || !was.running || running) return;
    const first = leadRef.current?.();
    if (first !== undefined) {
      sendRef.current(first);
      return;
    }
    if (queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    if (next) sendRef.current(next.value);
  }, [running, queued, resetKey]);

  // Queued text belongs to the conversation it was typed in, never the one
  // switched to.
  useEffect(() => { setQueued([]); }, [resetKey]);

  return { items: queued, count: queued.length, submit, remove, clear };
}
