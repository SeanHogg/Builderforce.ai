import { getRunDriver } from './runDriver';
import { queueRunSteering } from './runSteering';
import type { HandedTurn } from './runStore/continueChat';
import { onStoreReset } from './runStore/runCells';
import { isLive, subscribeRun } from './runStore/runControl';
import { wakeChat } from './runStore/wakeChat';

/**
 * Chat-keyed delivery: words for a chat's run, from anywhere, whichever chat is showing.
 *
 * Two doors, both keyed by the CHAT and never by what the person is looking at:
 *  - `handToChat`: turns for a chat that is not showing (what a chat switch leaves behind, a failed flush);
 *  - `deliverToChat` / `releaseChat`: turns held for a DRAFT's creation, once it answered with the chat they belong to.
 *    The chat's run may not exist yet (the draft's own first send is still saving its row), so they WAIT for it, and
 *    are steered into that run, oldest first, the moment it goes live - exactly as a send into that chat would end.
 *
 * Where the run executes is the run driver's business (`runDriver.ts`): a host whose runs live in another process
 * (the editor) hears the words through its `steer` verb - its inbox and wake - because the in-page inbox is read by
 * nobody there. Everywhere else the words go to the run store's inbox.
 */

/** A turn for a chat: its words and files, and whether it is direction for the run being made (`steer`) or waits for after it. */
export interface ChatDelivery extends HandedTurn {
  readonly steer: boolean;
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

/** One turn into a chat's run: through the driver where the run executes elsewhere, else the store's inbox (interrupting the step in flight). */
function sayToRun(chat: number, turn: HandedTurn): void {
  const driver = getRunDriver();
  if (driver) driver.steer(chat, turn.text, turn.attachments ? [...turn.attachments] : undefined);
  else handToChat(chat, [{ ...turn, interrupt: true }]);
}

/** Turns the chat's run was not there to hear (it never came, or it has ended): the chat's next turn(s), together, in order. */
function sayToIdleChat(chat: number, turns: readonly ChatDelivery[]): void {
  if (turns.length === 0) return;
  const driver = getRunDriver();
  if (driver) for (const turn of turns) driver.steer(chat, turn.text, turn.attachments ? [...turn.attachments] : undefined);
  else handToChat(chat, turns);
}

interface Waiting {
  turns: ChatDelivery[];
  /** The chat's run has been live since these turns began to wait: its falling edge is what `steer: false` turns wait for. */
  seenLive: boolean;
  off: () => void;
}

const waiting = new Map<number, Waiting>();

function forget(chat: number): void {
  const w = waiting.get(chat);
  if (!w) return;
  w.off();
  waiting.delete(chat);
}

/**
 * Move what is waiting for `chat` as far as its run allows. A live run hears the leading direction now, in order; a turn
 * held for after it (and everything behind that one, which must not jump it) waits for its falling edge, when the rest is
 * the chat's next turn.
 */
function pump(chat: number): void {
  const w = waiting.get(chat);
  if (!w) return;
  if (isLive(chat)) {
    w.seenLive = true;
    while (w.turns[0]?.steer) sayToRun(chat, w.turns.shift()!);
  } else if (w.seenLive) {
    const rest = w.turns;
    forget(chat);
    sayToIdleChat(chat, rest);
    return;
  }
  if (w.turns.length === 0) forget(chat);
}

/** Turns held for a draft's creation, which answered with `chat`: they wait for that chat's run and are heard by it, in order. */
export function deliverToChat(chat: number, turns: readonly ChatDelivery[]): void {
  if (turns.length === 0) return;
  const w = waiting.get(chat) ?? { turns: [], seenLive: false, off: subscribeRun(chat, () => pump(chat)) };
  waiting.set(chat, w);
  w.turns.push(...turns);
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
  sayToIdleChat(chat, w.turns);
}

/** The person stopped this chat: what waited for its run is dropped with it, like everything else held (a Stop wakes nothing). */
export function dropWaiting(chat: number): void {
  forget(chat);
}

onStoreReset(() => { for (const chat of [...waiting.keys()]) forget(chat); });
