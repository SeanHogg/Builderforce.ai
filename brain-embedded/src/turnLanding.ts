'use client';

import { useCallback, type MutableRefObject } from 'react';
import type { DraftOutcome } from './draftBinding';
import type { RunKey } from './brainRunStore';
import { queueRunSteering } from './runSteering';
import type { ChatInputAttachment } from './types';
import type { HandedTurn } from './runStore/continueChat';
import { isLive } from './runStore/runControl';
import { wakeChat } from './runStore/wakeChat';
import { getRunDriver } from './runDriver';
import { turnBody, type DraftHeld, type QueuedItem } from './useQueuedTurns';

/**
 * Where turns go when they are not sent from the composer: held turns whose conversation changed (`handOff`), and turns held
 * for a draft's creation once it answers (`landDraft`). Extracted from `useChatTurns`, which owns the ports and the queue.
 */

/** The door's ports this module reads - the newest, at call time. */
export interface LandingPorts<T> {
  restore: ((turn: T) => void) | undefined;
  join: ((turns: readonly T[]) => T) | undefined;
  textOf: ((turn: T) => string) | undefined;
  isDirected: ((turn: T) => boolean) | undefined;
  attachmentsOf: ((turn: T) => ChatInputAttachment[] | undefined) | undefined;
  runKey: RunKey | null;
  running: boolean;
}

/**
 * Hand turns to a chat that is not showing - its run's inbox, the way every send into a chat ends. A chat whose run is live
 * hears them in its inbox (`interrupt`: a turn that is direction for that run also interrupts the step in flight); an idle
 * one takes them together, in order, as ONE continuation (`wakeChat`: one row per turn); one that cannot is left them in the
 * inbox, saved (`persist`) and journaled under their own keys.
 */
export function handToChat(chat: number, turns: ReadonlyArray<HandedTurn & { interrupt?: boolean }>): void {
  const inbox = (turn: HandedTurn, interrupt: boolean): void => queueRunSteering(chat, turn.text, {
    fromPerson: true,
    persist: true,
    ...(interrupt ? { interrupt: true } : {}),
    ...(turn.attachments?.length ? { attachments: [...turn.attachments] } : {}),
  });
  if (isLive(chat)) {
    for (const turn of turns) inbox(turn, !!turn.interrupt);
    return;
  }
  // No run is reading: nothing to interrupt.
  if (!wakeChat(chat, turns)) for (const turn of turns) inbox(turn, false);
}

/**
 * The hand-offs of the one turn door. Turns given back to the composer that is showing go in ONE restore (the box holds one
 * draft): that is the one rule for everything a chat switch or a failed creation leaves behind.
 */
export function useTurnLanding<T>(
  ports: MutableRefObject<LandingPorts<T>>,
  pushBackRef: MutableRefObject<(turn: T, opts?: { preLiveFor?: number }) => void>,
) {
  // Turns given back to the composer that is showing, ALL of them in one restore (the box holds one draft): the one rule for
  // everything a chat switch or a failed creation leaves behind.
  const giveBackAll = useCallback((turns: readonly T[]) => {
    const { restore: giveBack, join } = ports.current;
    if (!giveBack || turns.length === 0) return;
    if (join && turns.length > 1) giveBack(join(turns));
    else for (const turn of turns) giveBack(turn);
  }, []);

  // The conversation changed with turns still held: they go to THEIR OWN chat, oldest first, nothing discarded - the
  // same path a send into that chat takes. An addressed turn (or any, where the run executes elsewhere) goes back to
  // the composer that is showing, ALL of them in one restore; the rest are handed to that chat TOGETHER, as one
  // continuation (`wakeChat`: one row per turn, in order), else to its inbox, saved - so there is one ordering rule.
  const handOff = useCallback((held: readonly QueuedItem<T>[], from: RunKey | null) => {
    const { textOf: text, attachmentsOf: attached, isDirected: directed } = ports.current;
    const back: T[] = [];
    const chat: HandedTurn[] = [];
    for (const { value: turn } of held) {
      if (directed?.(turn) || getRunDriver() || typeof from !== 'number') back.push(turn);
      else chat.push({ text: turnBody(turn, text), attachments: attached?.(turn) });
    }
    giveBackAll(back);
    if (chat.length > 0 && typeof from === 'number') handToChat(from, chat);
  }, [giveBackAll]);

  // A draft's creation answered: the turns held under ITS token land - whichever chat is showing now - exactly as a send into
  // the created chat would. Nothing created: back to the composer, joined. Never re-tagged, steered or handed to any other chat.
  const landDraft = useCallback((held: readonly DraftHeld<T>[], outcome: DraftOutcome) => {
    if (outcome === null) {
      giveBackAll(held.map((h) => h.value));
      return;
    }
    const { textOf: text, attachmentsOf: attached, isDirected: directed, runKey: key, running: live } = ports.current;
    const back: T[] = [];
    const chat: Array<HandedTurn & { interrupt: boolean }> = [];
    for (const { value: turn, followUp } of held) {
      const here = key === outcome && live; // the created chat is showing, its run in flight: a send there is held and steered when live
      if (here) pushBackRef.current(turn, followUp && !directed?.(turn) ? { preLiveFor: outcome } : undefined);
      else if (directed?.(turn) || getRunDriver()) back.push(turn);
      else chat.push({ text: turnBody(turn, text), attachments: attached?.(turn), interrupt: followUp });
    }
    giveBackAll(back);
    if (chat.length > 0) handToChat(outcome, chat);
  }, [giveBackAll]);

  return { handOff, landDraft };
}
