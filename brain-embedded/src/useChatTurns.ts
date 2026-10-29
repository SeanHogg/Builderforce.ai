'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { stopRun } from './brainRunStore';
import type { RunKey } from './brainRunStore';
import { drainRunSteering, queueRunSteering } from './runSteering';
import type { ChatInputAttachment } from './types';
import { wakeChat } from './runStore/wakeChat';
import { turnBody, useQueuedTurns, type QueuedTurns } from './useQueuedTurns';
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
 *  2. mid-run, the chat's own run is STEERED by default (PRD 35 E10) - by the door itself, or by
 *     the host's `steer` port, which is handed the door's verdict (`steersOwnRun`):
 *     the message is posted to the run's inbox, interrupts the step in flight and reaches the
 *     next model call — it does not wait behind a run that may hold for minutes. Holding it
 *     for after the run is the explicit alternative: `queueAfter`. Direction that arrives
 *     after the run's last drain is made the chat's NEXT turn by the run store when the run
 *     settles (`runStore/continueChat.ts`; the web twin of the editor's `runSteer.settled`) - not
 *     here: this hook holds only the turns the UI itself holds. A Stop drops what is still waiting;
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
  /**
   * Optional: route a turn into a live run instead; return true when it was taken. `steersOwnRun`
   * is the door's own verdict (`steersByDefault`, over the same state the composer's Send label
   * reads) on whether this turn may speak to the chat's own run - the port never recomputes it.
   */
  steer?: (turn: T, steersOwnRun: boolean) => boolean;
  /** Optional: how this host stops its run. Default `stopRun(runKey)`. */
  stop?: () => void;
  /** The text a non-string turn carries (blank check). Omit for string turns. */
  textOf?: (turn: T) => string;
  /** Optional: the turn is addressed to a participant, not the run — never the Stop. */
  isDirected?: (turn: T) => boolean;
  /** Optional: the attachments a non-string turn carries — they ride a steer so a mid-run image is not dropped. */
  attachmentsOf?: (turn: T) => ChatInputAttachment[] | undefined;
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
  /**
   * Would a message typed NOW steer the live run, or be held? The composer words its Send button
   * from this - the same predicate `submit` decides with, over the same state (a run being
   * stopped, turns already held this run). `preview` is what the box holds now. Read it during render.
   */
  steers: (preview: { directed: boolean; attachments?: readonly { imageUrl?: string }[] }) => boolean;
}

/**
 * Does a message typed mid-run STEER the live run (true), or is it held for after it (false)?
 * ONE predicate - `submit` decides with it and the composer words its Send button from it, so
 * the button never promises a steer the turn will not get. A turn addressed to a participant
 * is a message to them, not to the run; one behind turns already held waits its turn rather
 * than jump them; one carrying a file the model cannot read inline (anything but a picture)
 * is held, because a steer would drop the file.
 */
export function steersByDefault(turn: { directed: boolean; held: number; attachments?: readonly { imageUrl?: string }[] }): boolean {
  return !turn.directed && turn.held === 0 && (turn.attachments ?? []).every((a) => !!a.imageUrl);
}

export function useChatTurns<T = string>({ running, runKey, send, steer, stop, textOf, isDirected, attachmentsOf }: ChatTurnsOptions<T>): ChatTurns<T> {
  // Newest ports, read at call time — `submit`/`stop` keep their identity across renders
  // (hosts hand them to memoized composers and to callbacks captured at run start).
  const ports = useRef({ send, steer, stop, textOf, isDirected, attachmentsOf, runKey, running });
  // eslint-disable-next-line react-hooks/refs
  ports.current = { send, steer, stop, textOf, isDirected, attachmentsOf, runKey, running };
  // A stopped run is unwinding: a message typed meanwhile cannot steer it (the model gets no
  // further turn), so it is held for after - until the run's falling edge clears the mark. State
  // as well as a ref: the composer words its Send button from it.
  const stoppingRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const markStopping = useCallback((on: boolean) => { stoppingRef.current = on; setStopping(on); }, []);
  useEffect(() => { if (!running && stoppingRef.current) markStopping(false); }, [running, markStopping]);
  // Counts Stops: a send in flight when one lands must not put its turn back afterwards.
  const stopEpoch = useRef(0);

  // Direction steered into the run after its last drain is NOT this hook's to deliver: the run
  // store owns it (`continueOnSettle` -> `continueLeftovers`), on any chat, on screen or not.
  // This hook never drains the run-steering inbox on a completion - only a Stop does, below.

  // A flushed turn the host did not keep (its send failed before the turn was saved) goes back
  // to the front of the queue: it is the person's message, and a failed send is not a reason to
  // lose it. If the person has switched chats meanwhile it goes back to ITS chat instead
  // (`wakeChat`: that chat's next turn; failing that, its inbox), never into the one now showing.
  // And a Stop since the send began ended the conversation's work: nothing is put back.
  const requeueRef = useRef<(turn: T) => void>(() => undefined);
  const takeFrontRef = useRef<() => T | undefined>(() => undefined);
  const flush = useCallback(async function flushTurn(turn: T): Promise<void> {
    const key = ports.current.runKey;
    const epoch = stopEpoch.current;
    const kept = await Promise.resolve(ports.current.send(turn)).then((ok) => ok !== false, () => false);
    if (stopEpoch.current !== epoch) return;
    const { textOf: text, attachmentsOf: attached, isDirected: directed } = ports.current;
    if (kept) {
      // A turn that starts no run (a typed stop, sent idle) raises no falling edge, so the turns
      // held behind it would wait for a run that never comes: the next one goes now.
      if (ports.current.runKey !== key || startsRun(turnBody(turn, text)) || directed?.(turn)) return;
      const next = takeFrontRef.current();
      if (next !== undefined) await flushTurn(next);
      return;
    }
    if (ports.current.runKey === key) {
      requeueRef.current(turn);
      return;
    }
    if (typeof key !== 'number') return;
    const body = turnBody(turn, text);
    const files = attached?.(turn);
    if (!wakeChat(key, body, files)) queueRunSteering(key, body, { fromPerson: true, persist: true, ...(files?.length ? { attachments: files } : {}) });
  }, []);

  const queued = useQueuedTurns<T>({
    running,
    send: (turn) => { void flush(turn); },
    resetKey: runKey,
    textOf,
  });
  const { submit: hold, clear, takeFront, pushBack } = queued;
  // eslint-disable-next-line react-hooks/refs
  requeueRef.current = queued.requeue;
  // eslint-disable-next-line react-hooks/refs
  takeFrontRef.current = takeFront;
  // Turns already held: a message typed behind them waits its turn (it must not jump ahead).
  // Only those held THIS run count: a turn put back while idle (a failed flush) is carried into
  // the next run and must not force-hold everything typed during it. Tracked by turn ID - a
  // count would mistake a turn removed from the queue for one held this run - and marked in
  // render, on the run's rising edge, so the very render that goes live already words Send right.
  const itemsRef = useRef(queued.items);
  // eslint-disable-next-line react-hooks/refs
  itemsRef.current = queued.items;
  const carriedIds = useRef<ReadonlySet<number>>(new Set());
  const wasRunning = useRef(false);
  // eslint-disable-next-line react-hooks/refs
  if (running !== wasRunning.current) {
    if (running) carriedIds.current = new Set(queued.items.map((item) => item.id));
    wasRunning.current = running;
  }
  const heldThisRun = useCallback((): number => itemsRef.current.filter((item) => !carriedIds.current.has(item.id)).length, []);

  const stopTurns = useCallback(() => {
    clear();
    stopEpoch.current += 1;
    if (ports.current.running) markStopping(true);
    const { stop: halt, runKey: key } = ports.current;
    // A steer typed before the Stop is dropped with the run - it must not start the next one.
    if (typeof key === 'number') drainRunSteering(key);
    if (halt) halt();
    else if (key != null) stopRun(key);
  }, [clear, markStopping]);

  const submit = useCallback(async (turn: T): Promise<boolean> => {
    const { send: deliver, steer: route, textOf: text, isDirected: directed, attachmentsOf: attached, runKey: key, running: live } = ports.current;
    const body = turnBody(turn, text);
    if (!body) return false;
    const isStop = !startsRun(body) && !directed?.(turn);
    // The door's verdict on speaking to the chat's OWN run: one predicate (`steersByDefault`) for
    // this submit, the editor's steer port and the composer's Send label.
    const steersOwnRun = live && typeof key === 'number' && !stoppingRef.current
      && steersByDefault({ directed: !!directed?.(turn), held: heldThisRun(), attachments: attached?.(turn) });
    // A host that routed it (the editor's run hears it as its Stop) still drops what is held.
    if (route?.(turn, steersOwnRun)) {
      if (isStop) stopTurns();
      return true;
    }
    // Mid-run, a stop IS the Stop - nothing is held behind it to strand.
    if (isStop && live) {
      stopTurns();
      return true;
    }
    // Mid-run, the chat's own run is spoken to NOW: the message interrupts the step in flight
    // and is in front of the next model call. `persist` has the run save and show it as it
    // reads it. A host that supplied `steer` routed (or declined) it above and owns the rest.
    if (!route && steersOwnRun) {
      queueRunSteering(key as number, body, { interrupt: true, fromPerson: true, persist: true, attachments: attached?.(turn) });
      return true;
    }
    if (hold(turn)) return true;
    // Idle with turns still waiting (a flush the host did not keep): this one goes BEHIND them -
    // the oldest is sent now, and this follows when its run completes. It never jumps the line.
    const oldest = live ? undefined : takeFront();
    if (oldest !== undefined) {
      pushBack(turn);
      void flush(oldest);
      return true;
    }
    return (await deliver(turn)) !== false;
  }, [hold, stopTurns, takeFront, pushBack, flush, heldThisRun]);

  const queueAfter = useCallback(async (turn: T): Promise<boolean> => {
    const { textOf: text, send: deliver } = ports.current;
    if (!turnBody(turn, text)) return false;
    if (hold(turn)) return true;
    return (await deliver(turn)) !== false;
  }, [hold]);

  const steers = useCallback((preview: { directed: boolean; attachments?: readonly { imageUrl?: string }[] }): boolean => {
    // Steered words need only text and the files the run can read - any turn shape qualifies, and a
    // host with its own steer port is asked with this same verdict (`submit`), so the label and the
    // turn cannot disagree.
    // eslint-disable-next-line react-hooks/refs
    return typeof ports.current.runKey === 'number' && !stopping && steersByDefault({ ...preview, held: heldThisRun() });
  }, [stopping, heldThisRun]);

  return { queued, submit, queueAfter, stop: stopTurns, steers };
}
