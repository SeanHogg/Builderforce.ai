'use client';

import { useCallback, useEffect, useRef } from 'react';
import { stopRun } from './brainRunStore';
import type { RunKey } from './brainRunStore';
import { drainRunSteering, queueRunSteering } from './runSteering';
import type { ChatInputAttachment } from './types';
import { useQueuedTurns, type QueuedTurns } from './useQueuedTurns';
import { startsRun } from './userTurnRuns';

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
 *  2. mid-run, a host with no `steer` port STEERS the chat's own run by default (PRD 35 E10):
 *     the message is posted to the run's inbox, interrupts the step in flight and reaches the
 *     next model call — it does not wait behind a run that may hold for minutes. Holding it
 *     for after the run is the explicit alternative: `queueAfter`. Direction that arrives
 *     after the run's last drain is sent as the NEXT turn when the run completes (the web twin
 *     of the editor's `runSteer.settled`), and a Stop drops what is still waiting;
 *  3. the queue — a turn that cannot steer (addressed to a participant, a canvas key, a run
 *     being stopped, or one behind turns already held, which it must not jump) is HELD and
 *     sent on the run's falling edge (`useQueuedTurns`: FIFO, one per completed run,
 *     discarded on a `runKey` switch);
 *  4. otherwise `send` now.
 *
 * A stop ("Stop the run") is the Stop: mid-run it stops the run and drops what is held
 * (nothing waits behind it); idle it is sent, kept as the answer, and starts nothing
 * (`userTurnRuns.ts`). A stop addressed to a participant is a message, never the Stop.
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
  /** Optional: the turn is addressed to a participant, not the run — never the Stop. */
  isDirected?: (turn: T) => boolean;
  /** Optional: the attachments a non-string turn carries — they ride a steer so a mid-run image is not dropped. */
  attachmentsOf?: (turn: T) => ChatInputAttachment[] | undefined;
  /**
   * Optional: build a turn from steered text, for a host whose turn is more than a string. A
   * mid-run message steers by default only when a turn can be rebuilt from it — a string turn
   * always can; any other needs this. It is how direction left in the inbox when the run
   * completes becomes the next turn.
   */
  turnOf?: (text: string, attachments: ChatInputAttachment[]) => T;
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
  /** The explicit alternative to steering: hold the turn for after the run (sent on its falling edge). Stable identity. */
  queueAfter: (turn: T) => Promise<boolean>;
  /** Clear the queue and stop the run. Stable identity. */
  stop: () => void;
}

export function useChatTurns<T = string>({ running, runKey, send, steer, stop, textOf, isDirected, attachmentsOf, turnOf }: ChatTurnsOptions<T>): ChatTurns<T> {
  // Newest ports, read at call time — `submit`/`stop` keep their identity across renders
  // (hosts hand them to memoized composers and to callbacks captured at run start).
  const ports = useRef({ send, steer, stop, textOf, isDirected, attachmentsOf, turnOf, runKey, running });
  // eslint-disable-next-line react-hooks/refs
  ports.current = { send, steer, stop, textOf, isDirected, attachmentsOf, turnOf, runKey, running };
  // A stopped run is unwinding: a message typed meanwhile cannot steer it (the model gets no
  // further turn), so it is held for after — until the run's falling edge clears the mark.
  const stopping = useRef(false);
  useEffect(() => { if (!running) stopping.current = false; }, [running]);

  // Direction steered into the run after its last drain would never be read: when the run
  // completes it becomes the next turn, oldest first, ahead of the held ones.
  const lead = useCallback((): T | undefined => {
    const { steer: route, runKey: key, turnOf: build } = ports.current;
    if (route || typeof key !== 'number') return undefined;
    const left = drainRunSteering(key);
    if (left.length === 0) return undefined;
    const text = left.map((m) => m.text).join('

');
    return build ? build(text, left.flatMap((m) => m.attachments ?? [])) : (text as unknown as T);
  }, []);

  const queued = useQueuedTurns<T>({
    running,
    send: (turn) => { void ports.current.send(turn); },
    resetKey: runKey,
    textOf,
    lead,
  });
  const { submit: hold, clear } = queued;
  // Turns already held: a message typed behind them waits its turn (it must not jump ahead).
  const held = useRef(0);
  // eslint-disable-next-line react-hooks/refs
  held.current = queued.count;

  const stopTurns = useCallback(() => {
    clear();
    if (ports.current.running) stopping.current = true;
    const { stop: halt, runKey: key } = ports.current;
    // A steer typed before the Stop is dropped with the run — it must not start the next one.
    if (typeof key === 'number') drainRunSteering(key);
    if (halt) halt();
    else if (key != null) stopRun(key);
  }, [clear]);

  const submit = useCallback(async (turn: T): Promise<boolean> => {
    const { send: deliver, steer: route, textOf: text, isDirected: directed, attachmentsOf: attached, turnOf, runKey: key, running: live } = ports.current;
    const body = typeof turn === 'string' ? turn.trim() : (text?.(turn) ?? '').trim();
    if (!body) return false;
    const isStop = !startsRun(body) && !directed?.(turn);
    // A host that routed it (the editor's run hears it as its Stop) still drops what is held.
    if (route?.(turn)) {
      if (isStop) stopTurns();
      return true;
    }
    // Mid-run, a stop IS the Stop — nothing is held behind it to strand.
    if (isStop && live) {
      stopTurns();
      return true;
    }
    // Mid-run, the chat's own run is spoken to NOW: the message interrupts the step in flight
    // and is in front of the next model call. `persist` has the run save and show it as it
    // reads it. A host that supplied `steer` routed (or declined) it above and owns the rest.
    const canRebuild = typeof turn === 'string' || !!turnOf;
    if (live && !route && canRebuild && typeof key === 'number' && !directed?.(turn) && !stopping.current && held.current === 0) {
      queueRunSteering(key, body, { interrupt: true, fromPerson: true, persist: true, attachments: attached?.(turn) });
      return true;
    }
    if (hold(turn)) return true;
    return (await deliver(turn)) !== false;
  }, [hold, stopTurns]);

  const queueAfter = useCallback(async (turn: T): Promise<boolean> => {
    if (hold(turn)) return true;
    return (await ports.current.send(turn)) !== false;
  }, [hold]);

  return { queued, submit, queueAfter, stop: stopTurns };
}
