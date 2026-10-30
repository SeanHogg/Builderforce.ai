'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { stopRun } from './brainRunStore';
import type { RunKey } from './brainRunStore';
import type { DraftBinding, DraftToken } from './draftBinding';

/**
 * The turn door's Stop (`useChatTurns`): what marks it leaves, and what it ends.
 *
 * A Stop ends the CONVERSATION's work, not one sentence: the held turns, the run, and - for a draft whose first send has
 * already made a chat - that chat's launch and the turns waiting for its run. The conversation's own Stop (the `stop` port,
 * `useBrainConversation.stop`) owns the launch it cancels; the door only asks for it.
 */
export interface DoorStopMarks {
  /** True from a Stop until the run's falling edge: a message typed meanwhile cannot steer the unwinding run, it is held. */
  stoppingRef: MutableRefObject<boolean>;
  markStopping: (on: boolean) => void;
  /**
   * Counts Stops PER VIEW, by the run key the Stop was pressed on: a send in flight when a Stop lands on ITS view must not put
   * its turn back afterwards. A Stop on another view is not that send's (it would drop the turn: in no box, queue or chat).
   */
  stopEpochs: MutableRefObject<Map<RunKey | null, number>>;
}

export function useDoorStopMarks(running: boolean): DoorStopMarks {
  // The ref is what is read; the state exists only to repaint, because the composer words its Send button from it.
  const stoppingRef = useRef(false);
  const [, repaint] = useState(false);
  const markStopping = useCallback((on: boolean) => { stoppingRef.current = on; repaint(on); }, []);
  useEffect(() => { if (!running && stoppingRef.current) markStopping(false); }, [running, markStopping]);
  const stopEpochs = useRef(new Map<RunKey | null, number>());
  // Stable identity: `stop` keeps its identity across renders.
  return useMemo(() => ({ stoppingRef, markStopping, stopEpochs }), [markStopping]);
}

/** The Stops pressed so far on the view with this run key (a draft's is `null`). */
export const stopEpochOf = (marks: DoorStopMarks, key: RunKey | null): number => marks.stopEpochs.current.get(key) ?? 0;

/** The ports a Stop reads, newest at call time. */
export interface DoorStopPorts {
  running: boolean;
  runKey: RunKey | null;
  drafts?: DraftBinding;
  /**
   * How this host stops its run. Default `stopRun(runKey)`. Given the draft on screen - the conversation's Stop
   * (`useBrainConversation.stop`): the token of the draft showing, or `undefined` (a chat is showing, or the host has no binding).
   * A new draft with nothing sent has no token: the door stops no one for it.
   */
  stop?: (draft?: DraftToken) => void;
}

export function stopDoorTurns(ports: DoorStopPorts, marks: DoorStopMarks, clear: () => void): void {
  const { stop: halt, runKey: key, drafts: binding } = ports;
  // The draft on screen (a draft view has no run key): the Stop reaches ITS sends alone, never another draft's chat. A new
  // draft with nothing sent is `null` - nothing to stop; only a host with no binding names no token (`undefined`).
  const token = key === null ? (binding ? binding.current() : undefined) : undefined;
  clear(); // what THIS view holds goes with the Stop, wherever it is showing (another draft's tagged turns stay)
  // An empty new draft has no run, no send in flight and no draft to stop: it must not bump the epoch (a send in flight
  // elsewhere would be told it was stopped) or word the Send button for a run that is not unwinding.
  if (token === null) return;
  marks.stopEpochs.current.set(key, stopEpochOf(marks, key) + 1);
  if (ports.running) marks.markStopping(true);
  // A steer typed before the Stop is dropped with the run, and so is what a draft's creation delivered to this chat that
  // its run has not heard yet (the store's Stop drains the inbox, the device's journal and the chat's waiting turns -
  // every entry point to Stop does) - none of it may start the next one.
  if (halt) halt(token);
  else if (key != null) stopRun(key);
  // On a draft whose creation already made chat N, N's run and the turns waiting for it are the conversation's too, and
  // THIS is the one path that stops it, once: the conversation's Stop only cancels a launch that has not started
  // (`launchCancel.ts`) and never stops a chat's run - so a Stop on another draft cannot reach it.
  const made = token != null ? binding?.outcomeOf(token) : undefined;
  if (typeof made === 'number') stopRun(made);
}
