import { getRunDriver } from './runDriver';
import { newSteerKey, queueRunSteering } from './runSteering';
import type { HandedTurn } from './runStore/continueChat';
import { onStoreReset } from './runStore/runCells';
import { isLive, onRunStopped, subscribeRun } from './runStore/runControl';
import { wakeChat } from './runStore/wakeChat';

/**
 * Chat-keyed delivery: words for a chat's run, from anywhere, whichever chat is showing. ONE rule for every path on every host.
 *
 * Two doors, both keyed by the CHAT and never by what the person is looking at:
 *  - `handToChat`: turns for a chat that is not showing (what a chat switch leaves behind, a failed flush, a turn the chat's
 *    run is to hear now);
 *  - `deliverToChat` / `releaseChat`: turns held for a DRAFT's creation, once it answered with the chat they belong to.
 *    The chat's run may not exist yet (the draft's own first send is still saving its row), so they WAIT for it, and
 *    are steered into that run, oldest first, the moment it goes live - exactly as a send into that chat would end.
 *    While they wait they are VISIBLE and REMOVABLE (`waitingFor` / `removeWaiting` / `subscribeWaiting`): the chat's
 *    queue shows them.
 *
 * Where the run executes is the run driver's business (`runDriver.ts`): a host whose runs live in another process
 * (the editor) hears the words through its `steer` verb - its inbox and wake - because the in-page inbox is read by
 * nobody there. Everywhere else the words go to the run store's inbox.
 */

/**
 * A turn for a chat: its words and files, and whether it is direction for the run being made (`steer`) or waits for after it.
 * `turn` is the host's own value it was made from (opaque here): kept so the chat's queue can SHOW it and a send that is not
 * kept can give it back.
 */
export interface ChatDelivery extends HandedTurn {
  readonly steer: boolean;
  readonly turn?: unknown;
}

/** The host's own turn a delivery was made from, or - when it carried none - its text (the shape of a plain string turn): ONE rule for showing a waiting turn and for giving it back. */
export function waitedTurn<T>(delivery: ChatDelivery): T {
  return (delivery.turn ?? delivery.text) as T;
}

/** A turn waiting for its chat's run, as the queue shows it. `id` is negative: never the id of a turn the queue itself holds. */
export interface WaitingTurn extends ChatDelivery {
  readonly id: number;
  /** Names this turn to the run driver, so a host that hears it twice acts once. */
  readonly eventKey: string;
}

/**
 * Hand turns to a chat that is not showing - its run's inbox, the way every send into a chat ends. Where the run executes
 * elsewhere (a run driver) they go through the driver's `steer`, ONE call for all of them: the host that owns the run decides
 * (heard by the live run, else the chat's next turn together). Everywhere else a chat whose run is live hears them in its inbox
 * (`interrupt`: a turn that is direction for that run also interrupts the step in flight); an idle one takes them together, in
 * order, as ONE continuation (`wakeChat`: one row per turn); one that cannot is left them in the inbox, saved (`persist`) and
 * journaled under their own keys.
 */
export function handToChat(chat: number, turns: ReadonlyArray<HandedTurn & { interrupt?: boolean; eventKey?: string }>): void {
  if (turns.length === 0) return;
  const driver = getRunDriver();
  if (driver) {
    driver.steer(chat, turns.map((turn) => ({
      text: turn.text,
      ...(turn.attachments?.length ? { attachments: [...turn.attachments] } : {}),
      eventKey: turn.eventKey ?? newSteerKey(),
    })));
    return;
  }
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

interface Waiting {
  turns: WaitingTurn[];
  /** The chat's run has been live since these turns began to wait: its falling edge is what `steer: false` turns wait for. */
  seenLive: boolean;
  off: () => void;
}

const waiting = new Map<number, Waiting>();
let lastId = 0;
let version = 0;
const watchers = new Set<() => void>();

function changed(): void {
  version += 1;
  for (const watch of [...watchers]) watch();
}

/** A chat's waiting entry (and its subscription to the run) is gone. */
function forget(chat: number): void {
  const w = waiting.get(chat);
  if (!w) return;
  w.off();
  waiting.delete(chat);
  changed();
}

/**
 * Move what is waiting for `chat` as far as its run allows. A live run hears the leading direction now, in order, together; a
 * turn held for after it (and everything behind that one, which must not jump it) waits for its falling edge, when the rest is
 * the chat's next turn.
 */
function pump(chat: number): void {
  const w = waiting.get(chat);
  if (!w) return;
  if (isLive(chat)) {
    w.seenLive = true;
    const heard = w.turns.findIndex((turn) => !turn.steer);
    const now = w.turns.splice(0, heard < 0 ? w.turns.length : heard);
    if (now.length > 0) {
      changed();
      handToChat(chat, now.map((turn) => ({ ...turn, interrupt: true })));
    }
  } else if (w.seenLive) {
    const rest = w.turns;
    forget(chat);
    handToChat(chat, rest);
    return;
  }
  if (w.turns.length === 0) forget(chat);
}

/** Turns held for a draft's creation, which answered with `chat`: they wait for that chat's run and are heard by it, in order. */
export function deliverToChat(chat: number, turns: readonly ChatDelivery[]): void {
  if (turns.length === 0) return;
  const w = waiting.get(chat) ?? { turns: [], seenLive: false, off: subscribeRun(chat, () => pump(chat)) };
  waiting.set(chat, w);
  w.turns.push(...turns.map((turn) => ({ ...turn, id: (lastId -= 1), eventKey: newSteerKey() })));
  changed();
  pump(chat);
}

/**
 * Nothing more is coming to start the chat's run (the sends that were making it have ended): a run that is live hears
 * what waits as it always does, and with none the turns are the chat's next turn(s) - they are never left waiting for a
 * run that will not come.
 */
export function releaseChat(chat: number): void {
  const w = waiting.get(chat);
  if (!w) return;
  if (isLive(chat)) {
    pump(chat);
    return;
  }
  forget(chat);
  handToChat(chat, w.turns);
}

/**
 * The send that was making the chat's run did not keep its turn, and that run was never seen live: what waits for it has nothing
 * to follow. Taken back, oldest first, for the caller to give to the composer WITH the send's own turn. Empty when nothing
 * waits, or the run has been live (what was said to it is already heard).
 */
export function takeBackWaiting(chat: number): readonly WaitingTurn[] {
  const w = waiting.get(chat);
  if (!w || w.seenLive) return [];
  forget(chat);
  return w.turns;
}

/** The turns waiting for `chat`'s run, oldest first - what its queue shows. */
export function waitingFor(chat: number): readonly WaitingTurn[] {
  return waiting.get(chat)?.turns ?? [];
}

/** The person removed a waiting turn from the queue (by its `id`): it is not delivered. */
export function removeWaiting(id: number): void {
  for (const [chat, w] of waiting) {
    const at = w.turns.findIndex((turn) => turn.id === id);
    if (at < 0) continue;
    w.turns.splice(at, 1);
    if (w.turns.length === 0) forget(chat);
    else changed();
    return;
  }
}

/** Called when anything waiting changes; the number moves with it (a `useSyncExternalStore` source). */
export function subscribeWaiting(listener: () => void): () => void {
  watchers.add(listener);
  return () => { watchers.delete(listener); };
}
export function waitingVersion(): number {
  return version;
}

const deletedListeners = new Set<(chat: number) => void>();
/** Called when a chat is deleted (`forgetChatDelivery`): whoever keeps something keyed by a chat id (a draft's resolved token) lets go of it. */
export function onChatDeleted(listener: (chat: number) => void): () => void {
  deletedListeners.add(listener);
  return () => { deletedListeners.delete(listener); };
}

/** The chat is gone (deleted): nothing will ever run in it - what waited for it, and its subscription, go too, and so does every draft token that resolved to it. */
export function forgetChatDelivery(chat: number): void {
  forget(chat);
  for (const listener of [...deletedListeners]) listener(chat);
}

// A Stop on a chat - from the composer, a typed stop, the conversation's own `stop`, anywhere - ends the work waiting for its
// run, like everything else held (a Stop wakes nothing). The store's Stop seam calls this, so no entry point can miss it.
onRunStopped(forget);
onStoreReset(() => { for (const chat of [...waiting.keys()]) forget(chat); });
