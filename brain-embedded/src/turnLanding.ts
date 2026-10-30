'use client';

import { useCallback, useRef, type MutableRefObject } from 'react';
import { deliverToChat, handToChat, releaseChat, takeBackWaiting, waitedTurn, type ChatDelivery } from './chatDelivery';
import type { DraftBinding, DraftOutcome, DraftToken } from './draftBinding';
import type { RunKey } from './brainRunStore';
import type { ChatInputAttachment } from './types';
import type { HandedTurn } from './runStore/continueChat';
import { turnBody, type DraftHeld, type QueuedItem } from './useQueuedTurns';

/**
 * Where turns go when they are not sent from the composer: held turns whose conversation changed (`handOff`), and turns held
 * for a draft's creation once it answers (`landDraft`). Extracted from `useChatTurns`, which owns the ports and the queue.
 *
 * A DRAFT's turns are delivered by the creation that made their chat, THROUGH THAT CHAT'S RUN (`chatDelivery.ts`) - never by
 * asking which chat is showing, and never by restoring them to the composer because a run driver is installed. The same
 * binding owns the send that began the creation: when the creation fails, the send's own turn and everything held behind
 * it come back to the composer as ONE joined turn, once, and the send reports itself kept.
 */

/** What the host's `send` is told about the send it is asked to make. */
export interface SendContext {
  /**
   * The draft token this send began with (`draftBinding.begin`), when it starts from a draft: hand it to the conversation's
   * `send` so the creation it triggers is THIS draft's (`ensureChatId(token)`), never whichever draft is on screen by then.
   */
  readonly draft?: DraftToken;
}

/** The door's ports this module reads - the newest, at call time. */
export interface LandingPorts<T> {
  send: (turn: T, ctx?: SendContext) => Promise<boolean | void> | boolean | void;
  restore: ((turn: T) => void) | undefined;
  join: ((turns: readonly T[]) => T) | undefined;
  textOf: ((turn: T) => string) | undefined;
  isDirected: ((turn: T) => boolean) | undefined;
  attachmentsOf: ((turn: T) => ChatInputAttachment[] | undefined) | undefined;
  runKey: RunKey | null;
  drafts: DraftBinding | undefined;
}

/** One send from a draft, while it is in flight. */
interface Flying<T> {
  readonly turn: T;
  ended: boolean;
}

/** What one draft token's sends are doing. */
interface Flight<T> {
  flying: Flying<T>[];
  /** The chat the token's creation made, once it answered. */
  chat: number | null;
  /** The creation failed: the sends that were in flight then, whose turns the door restores - with the held ones, once. */
  owned: Flying<T>[] | null;
  held: readonly T[];
}

/**
 * The hand-offs of the one turn door. Turns given back to the composer that is showing go in ONE restore (the box holds one
 * draft): that is the one rule for everything a chat switch or a failed creation leaves behind.
 */
export function useTurnLanding<T>(ports: MutableRefObject<LandingPorts<T>>) {
  const flights = useRef(new Map<DraftToken, Flight<T>>());

  // Turns given back to the composer that is showing, ALL of them in one restore (the box holds one draft): the one rule for
  // everything a chat switch or a failed creation leaves behind.
  const giveBackAll = useCallback((turns: readonly T[]) => {
    const { restore: giveBack, join } = ports.current;
    if (!giveBack || turns.length === 0) return;
    if (join && turns.length > 1) giveBack(join(turns));
    else for (const turn of turns) giveBack(turn);
  }, [ports]);

  // The conversation changed with turns still held: they go to THEIR OWN chat, oldest first, nothing discarded - the
  // same path a send into that chat takes, wherever its run executes (`handToChat`: the run driver's steer, else the
  // chat's next turn together, else its inbox). An addressed turn goes back to the composer that is showing, ALL of
  // them in one restore - so there is one delivery rule and one ordering rule.
  const handOff = useCallback((held: readonly QueuedItem<T>[], from: RunKey | null) => {
    const { textOf: text, attachmentsOf: attached, isDirected: directed } = ports.current;
    const back: T[] = [];
    const chat: HandedTurn[] = [];
    for (const { value: turn } of held) {
      if (directed?.(turn) || typeof from !== 'number') back.push(turn);
      else chat.push({ text: turnBody(turn, text), attachments: attached?.(turn) });
    }
    giveBackAll(back);
    if (chat.length > 0 && typeof from === 'number') handToChat(from, chat);
  }, [giveBackAll, ports]);

  // The creation failed. The sends still in flight for it are the door's to put back, together with everything held behind
  // them, in ONE restore - once the last of them has ended (it reports itself kept; the host's own put-back does nothing).
  const restoreFailed = useCallback((token: DraftToken, flight: Flight<T>) => {
    const turns = [...(flight.owned ?? []).map((send) => send.turn), ...flight.held];
    flights.current.delete(token);
    giveBackAll(turns);
  }, [giveBackAll]);

  // A draft's creation answered. Its chat: the turns held under ITS token are delivered through THAT chat's run, whichever chat
  // is showing now (an addressed one goes back to the composer: it is not the run's to read). No chat: the send's own turn and
  // the held ones go back to the composer, joined, once.
  const landDraft = useCallback((held: readonly DraftHeld<T>[], outcome: DraftOutcome, token: DraftToken) => {
    const flight = flights.current.get(token);
    if (outcome === null) {
      if (!ports.current.restore) return; // nowhere to give them back: the host's own put-back keeps the send's turn
      const values = held.map((h) => h.value);
      if (!flight || flight.flying.length === 0) {
        flights.current.delete(token);
        giveBackAll(values);
        return;
      }
      flight.owned = [...flight.flying];
      flight.held = values;
      return;
    }
    const { textOf: text, attachmentsOf: attached, isDirected: directed } = ports.current;
    const back: T[] = [];
    const chat: ChatDelivery[] = [];
    for (const { value: turn, followUp } of held) {
      if (directed?.(turn)) back.push(turn);
      else chat.push({ text: turnBody(turn, text), attachments: attached?.(turn), steer: followUp, turn });
    }
    giveBackAll(back);
    deliverToChat(outcome, chat);
    // Sends still making the chat's run will start it; with none coming, the turns are not left waiting for a run that won't.
    if (flight && flight.flying.length > 0) flight.chat = outcome;
    else releaseChat(outcome);
  }, [giveBackAll, ports]);

  // The host's send, for one turn. FROM A DRAFT the send is what creates the chat: its token is minted here, synchronously,
  // before the send does any async preparation (the editor's limbic fetch), handed to the send (`ctx.draft`) so the creation is
  // THIS token's, and settled when the send returns - a send that ended without ever creating a chat has nothing coming for the
  // turns held under it. When the token's creation failed the door has put this turn back itself (with the held ones, joined):
  // the send is then reported kept, so the host does not restore it a second time.
  const sendOnce = useCallback(async (turn: T): Promise<unknown> => {
    const { send: deliver, runKey: key, drafts: binding } = ports.current;
    if (key !== null || !binding) return deliver(turn);
    const token = binding.begin();
    const flight = flights.current.get(token) ?? { flying: [], chat: null, owned: null, held: [] };
    flights.current.set(token, flight);
    const mine: Flying<T> = { turn, ended: false };
    flight.flying.push(mine);
    let result: unknown;
    let thrown: { error: unknown } | null = null;
    try {
      result = await deliver(turn, { draft: token });
    } catch (error) {
      thrown = { error };
    }
    binding.settle(token); // may fail the token: landDraft above then sees this send as one of the failed creation's
    mine.ended = true;
    flight.flying = flight.flying.filter((send) => send !== mine);
    let taken = !!flight.owned?.includes(mine);
    // The LAST send that was making the chat's run was NOT kept after the creation answered, and that run was never live: what
    // waits for it has nothing to follow (another send from the draft still in flight may yet start it). It comes back with the
    // send in ONE restore, the send first, and the send is reported kept (the host puts nothing back twice) - the same path as
    // a creation that failed.
    if (!taken && flight.chat !== null && flight.flying.length === 0 && (thrown !== null || result === false) && ports.current.restore) {
      const back = takeBackWaiting(flight.chat);
      if (back.length > 0) {
        giveBackAll([turn, ...back.map((waited) => waitedTurn<T>(waited))]);
        taken = true;
      }
    }
    if (flight.owned && flight.owned.every((send) => send.ended)) restoreFailed(token, flight);
    else if (flight.flying.length === 0) {
      if (flight.chat !== null) releaseChat(flight.chat);
      if (!flight.owned) flights.current.delete(token);
    }
    if (taken) return true;
    if (thrown) throw thrown.error;
    return result;
  }, [ports, restoreFailed, giveBackAll]);

  return { handOff, landDraft, sendOnce };
}
