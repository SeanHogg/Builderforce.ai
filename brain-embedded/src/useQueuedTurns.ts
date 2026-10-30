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
/** The text a turn carries, trimmed - the ONE blank check every door uses. A string turn is its own text. */
export function turnBody<T>(turn: T, textOf?: (turn: T) => string): string {
  return (typeof turn === 'string' ? turn : (textOf?.(turn) ?? '')).trim();
}

export interface QueuedItem<T> {
  /** Stable per held turn, so a host can render it and let the user remove it. */
  readonly id: number;
  readonly value: T;
  /**
   * Held only because no run was live yet (typed while the turn that starts it was still getting ready) - in THIS
   * chat's run. `null`: in the run of a chat that does not exist yet (a draft whose first turn is creating it); the
   * chat's first id re-tags it with that id.
   */
  readonly preLiveFor?: number | null;
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
  submit: (value: T, opts?: { preLiveFor?: number | null }) => boolean;
  /** Drop one held turn (the user removed it, or steered it into the run). */
  remove: (id: number) => void;
  /** Put a turn back at the FRONT of the queue - a flushed turn the host did not keep must not be lost. */
  requeue: (value: T) => void;
  /** Add a turn at the BACK, held or not - an idle send waits behind the turns already waiting. */
  pushBack: (value: T) => void;
  /** Take the OLDEST waiting turn out of the queue now (undefined when none). */
  takeFront: () => T | undefined;
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
   * Asked on the running->idle edge before a held turn is taken: false leaves the queue alone. A
   * host that is already sending a turn (and will chain on to the next when it is done) says so, so
   * the edge and that chain never both send - one path, whatever order the renders land in.
   */
  mayFlush?: () => boolean;
  /**
   * The conversation changed while turns were still held: every one of them, oldest first, with the key it was held
   * in. Each belongs to THAT conversation - the host hands it there (its run's inbox, or back to the composer) -
   * so nothing a person typed is discarded by a chat switch. Without it the held turns are dropped (a host with
   * nowhere to hand them).
   */
  handOff?: (held: readonly QueuedItem<T>[], fromKey: string | number | null) => void;
}

export function useQueuedTurns<T = string>({ running, send, resetKey = null, textOf, mayFlush, handOff }: QueuedTurnsOptions<T>): QueuedTurns<T> {
  const [queued, setQueued] = useState<QueuedItem<T>[]>([]);
  // The queue is READ synchronously too (`takeFront`, the flush): this ref is the source of
  // truth and every change goes through `update`, so two moves in one tick see each other.
  const queueRef = useRef<QueuedItem<T>[]>([]);
  const update = useCallback((change: (current: QueuedItem<T>[]) => QueuedItem<T>[]) => {
    const next = change(queueRef.current);
    if (next === queueRef.current) return;
    queueRef.current = next;
    setQueued(next);
  }, []);
  const nextId = useRef(0);
  // The flush effect must call the CURRENT send closure without re-running (and
  // re-sending) every time the host re-renders with a new one.
  const sendRef = useRef(send);
  // eslint-disable-next-line react-hooks/refs
  sendRef.current = send;
  const textOfRef = useRef(textOf);
  // eslint-disable-next-line react-hooks/refs
  textOfRef.current = textOf;
  const handOffRef = useRef(handOff);
  // eslint-disable-next-line react-hooks/refs
  handOffRef.current = handOff;
  const mayFlushRef = useRef(mayFlush);
  // eslint-disable-next-line react-hooks/refs
  mayFlushRef.current = mayFlush;
  const runningRef = useRef(running);

  const submit = useCallback((value: T, opts?: { preLiveFor?: number | null }) => {
    const text = turnBody(value, textOfRef.current);
    if (!text) return false;
    if (!runningRef.current) return false;
    const held = (typeof value === 'string' ? text : value) as T;
    update((current) => [...current, { id: (nextId.current += 1), value: held, ...(opts?.preLiveFor !== undefined ? { preLiveFor: opts.preLiveFor } : {}) }]);
    return true;
  }, [update]);
  // Read through a ref so `submit`'s identity survives a run starting: hosts
  // wrap it in their own useCallback, and a changing identity there re-creates
  // the composer's submit handler on every token.
  // eslint-disable-next-line react-hooks/refs
  runningRef.current = running;

  const remove = useCallback((id: number) => update((current) => current.filter((item) => item.id !== id)), [update]);
  const clear = useCallback(() => update((current) => (current.length ? [] : current)), [update]);
  const requeue = useCallback((value: T) => update((current) => [{ id: (nextId.current += 1), value }, ...current]), [update]);
  const pushBack = useCallback((value: T) => update((current) => [...current, { id: (nextId.current += 1), value }]), [update]);
  const takeFront = useCallback((): T | undefined => {
    const [first] = queueRef.current;
    if (!first) return undefined;
    update((current) => current.slice(1));
    return first.value;
  }, [update]);

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
    if (mayFlushRef.current && !mayFlushRef.current()) return;
    const next = takeFront();
    if (next !== undefined) sendRef.current(next);
  }, [running, resetKey, takeFront]);

  // Queued text belongs to the conversation it was typed in, never the one switched to: it leaves this queue and
  // goes to ITS conversation (`handOff`) - in order, nothing discarded.
  const heldIn = useRef(resetKey);
  useEffect(() => {
    const from = heldIn.current;
    if (from === resetKey) return;
    heldIn.current = resetKey;
    const held = queueRef.current;
    if (held.length === 0) return;
    // A draft's first id is NOT a switch: the turn in flight is creating the chat these turns were typed for. They stay
    // held, and the ones that waited only for a run to exist now wait for THIS chat's (they steer into it when it is live).
    if (from === null && typeof resetKey === 'number' && runningRef.current) {
      update((current) => current.map((item) => (item.preLiveFor === null ? { ...item, preLiveFor: resetKey } : item)));
      return;
    }
    update(() => []);
    handOffRef.current?.(held, from);
  }, [resetKey, update]);

  return { items: queued, count: queued.length, submit, remove, requeue, pushBack, takeFront, clear };
}
