'use client';

import { useCallback, useRef } from 'react';
import { stopRun } from './brainRunStore';
import type { RunKey } from './brainRunStore';
import { useQueuedTurns, type QueuedTurns } from './useQueuedTurns';

/**
 * THE ONE DOOR a user turn leaves a composer through — typed, an answered question, a
 * "Send again", a neighbouring surface handing text over — and the ONE Stop. Extracted
 * from the web Brain panel's controller (`useBrainPanelController`), which the editor
 * chat (`useChatSend`), Rovr (`ChatView`) and the Creation Canvas (`useCanvasTurnQueue`)
 * each re-wrapped around the shared queue.
 *
 * Order of a submit:
 *  1. `steer` (optional port) — a turn the host routes INTO a live run (the editor's
 *     live sub-agent, or a run waiting on its sub-agents) is delivered there, never
 *     queued behind the chat's own run;
 *  2. the queue — while `running`, the turn is HELD and sent on the run's falling edge
 *     (`useQueuedTurns`: FIFO, one per completed run, discarded on a `runKey` switch);
 *  3. otherwise `send` now.
 *
 * Stop drops everything queued (the person stopped the conversation, not one sentence)
 * and stops the run: the `stop` port when given, else `stopRun(runKey)` on the store.
 *
 * Policy that differs per host stays with the host and runs BEFORE `submit`: an exam
 * gate, an activity signal, clearing the draft. Draft restore uses `submit`'s result.
 * Chat creation is NOT here — mount `useChatCreation` before the conversation (its
 * `ensureChatId` is a conversation option, and this hook needs the conversation's
 * `running`), and call `ensureChatId` from inside `send` when the host has no
 * conversation hook to do it.
 */
export interface ChatTurnsOptions<T> {
  /** True while a turn is in flight on this conversation. */
  running: boolean;
  /** The run being driven (chat id, `canvasRunKey(sessionId)`, …); null for a draft. Also the queue's reset key. */
  runKey: RunKey | null;
  /** Deliver one turn now. Resolve `false` when it failed before it was kept (restore the draft). */
  send: (turn: T) => Promise<boolean | void> | boolean | void;
  /** Optional: route a turn into a live run instead; return true when it was taken. */
  steer?: (turn: T) => boolean;
  /** Optional: how this host stops its run. Default `stopRun(runKey)`. */
  stop?: () => void;
  /** The text a non-string turn carries (blank check). Omit for string turns. */
  textOf?: (turn: T) => string;
}

export interface ChatTurns<T> {
  /** The held turns (render them; let the user remove one). `queued.submit` is the raw hold-or-not primitive. */
  queued: QueuedTurns<T>;
  /**
   * Steer, queue or send one turn. Resolves `false` only when the turn was blank or
   * `send` reported it was not kept — the cue to restore the draft; `true` otherwise.
   * Stable identity.
   */
  submit: (turn: T) => Promise<boolean>;
  /** Clear the queue and stop the run. Stable identity. */
  stop: () => void;
}

export function useChatTurns<T = string>({ running, runKey, send, steer, stop, textOf }: ChatTurnsOptions<T>): ChatTurns<T> {
  // Newest ports, read at call time — `submit`/`stop` keep their identity across renders
  // (hosts hand them to memoized composers and to callbacks captured at run start).
  const ports = useRef({ send, steer, stop, textOf, runKey });
  // eslint-disable-next-line react-hooks/refs
  ports.current = { send, steer, stop, textOf, runKey };

  const queued = useQueuedTurns<T>({
    running,
    send: (turn) => { void ports.current.send(turn); },
    resetKey: runKey,
    textOf,
  });
  const { submit: hold, clear } = queued;

  const submit = useCallback(async (turn: T): Promise<boolean> => {
    const { send: deliver, steer: route, textOf: text } = ports.current;
    const body = typeof turn === 'string' ? turn.trim() : (text?.(turn) ?? '').trim();
    if (!body) return false;
    if (route?.(turn)) return true;
    if (hold(turn)) return true;
    return (await deliver(turn)) !== false;
  }, [hold]);

  const stopTurns = useCallback(() => {
    clear();
    const { stop: halt, runKey: key } = ports.current;
    if (halt) halt();
    else if (key != null) stopRun(key);
  }, [clear]);

  return { queued, submit, stop: stopTurns };
}
