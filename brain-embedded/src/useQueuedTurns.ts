'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NO_DRAFTS, type DraftBinding, type DraftOutcome, type DraftToken } from './draftBinding';

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
  /** Held only because no run was live yet - in THIS chat's run: steered into it the moment it goes live. */
  readonly preLiveFor?: number;
  /**
   * Held for a DRAFT's creation (`draftBinding.ts`): typed while the first send was still creating the chat. Owned by that
   * creation's token - not by a chat id and not by the chat showing - so switching the visible chat leaves it alone. It is
   * in no other chat's queue (`items`), and only its own token's answer settles it. `followUp`: direction for the run being
   * made; otherwise held for after it (`queueAfter`).
   */
  readonly draft?: { readonly token: DraftToken; readonly followUp: boolean };
}

/** A turn a draft's creation answered for: the value, and whether it is direction for the run being made. */
export interface DraftHeld<T> {
  readonly value: T;
  readonly followUp: boolean;
}

export interface QueuedTurns<T = string> {
  /** The held turns this view shows, oldest first (the showing draft's included; another draft's never). */
  items: readonly QueuedItem<T>[];
  /** How many turns are waiting. */
  count: number;
  /**
   * Offer a turn to the queue. Returns true when it was HELD (a run is in
   * flight and the caller must not send), false when the caller should send it
   * now. Written this way so the host keeps ownership of how it sends.
   */
  submit: (value: T, opts?: { preLiveFor?: number; draft?: QueuedItem<T>['draft'] }) => boolean;
  /** Drop one held turn (the user removed it, or steered it into the run). */
  remove: (id: number) => void;
  /** Put a turn back at the FRONT of the queue - a flushed turn the host did not keep must not be lost. */
  requeue: (value: T) => void;
  /** Add a turn at the BACK, held or not - an idle send waits behind the turns already waiting. */
  pushBack: (value: T, opts?: { preLiveFor?: number }) => void;
  /** Take the OLDEST waiting turn out of the queue now (undefined when none). Never one held for a draft's creation. */
  takeFront: () => T | undefined;
  /** Drop everything this view holds - a stopped run. Turns held for another draft's creation are not its to drop. */
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
   * nowhere to hand them). Turns held for a draft's creation are NOT handed off here: their token's answer settles them.
   */
  handOff?: (held: readonly QueuedItem<T>[], fromKey: string | number | null) => void;
  /**
   * The draft binding (`useChatCreation().drafts`): which creation each draft-held turn belongs to. Optional - a host
   * without draft creation holds none.
   */
  drafts?: DraftBinding;
  /**
   * A draft's creation answered - the chat id, or null when nothing was created: these turns, oldest first, were held for
   * it. They have left the queue; the host lands them (in the created chat, whichever chat is showing; back to the
   * composer when nothing was created), keeping some in the showing chat's queue with `pushBack` when that is the one.
   */
  landDraft?: (held: readonly DraftHeld<T>[], outcome: DraftOutcome) => void;
}

export function useQueuedTurns<T = string>({ running, send, resetKey = null, textOf, mayFlush, handOff, drafts = NO_DRAFTS, landDraft }: QueuedTurnsOptions<T>): QueuedTurns<T> {
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
  const landDraftRef = useRef(landDraft);
  // eslint-disable-next-line react-hooks/refs
  landDraftRef.current = landDraft;
  // The draft on screen: its held turns are the ones this view shows. A chat shows none of any draft's.
  const draftOnScreen = useSyncExternalStore(drafts.subscribe, drafts.current, drafts.current);
  const shown = resetKey === null ? draftOnScreen : null;
  const shownRef = useRef(shown);
  // eslint-disable-next-line react-hooks/refs
  shownRef.current = shown;
  const runningRef = useRef(running);

  const submit = useCallback((value: T, opts?: { preLiveFor?: number; draft?: QueuedItem<T>['draft'] }) => {
    const text = turnBody(value, textOfRef.current);
    if (!text) return false;
    if (!runningRef.current) return false;
    const held = (typeof value === 'string' ? text : value) as T;
    update((current) => [...current, {
      id: (nextId.current += 1),
      value: held,
      ...(opts?.preLiveFor !== undefined ? { preLiveFor: opts.preLiveFor } : {}),
      ...(opts?.draft ? { draft: opts.draft } : {}),
    }]);
    return true;
  }, [update]);
  // Read through a ref so `submit`'s identity survives a run starting: hosts
  // wrap it in their own useCallback, and a changing identity there re-creates
  // the composer's submit handler on every token.
  // eslint-disable-next-line react-hooks/refs
  runningRef.current = running;

  const remove = useCallback((id: number) => update((current) => current.filter((item) => item.id !== id)), [update]);
  // A Stop drops what THIS view holds: the chat's own turns and the showing draft's. Turns held for another draft's
  // creation (still answering for a draft the person left) are in no view of this chat, and a Stop here is not theirs.
  const clear = useCallback(() => update((current) => {
    const own = (item: QueuedItem<T>): boolean => !item.draft || item.draft.token === shownRef.current;
    return current.some(own) ? current.filter((item) => !own(item)) : current;
  }), [update]);
  const requeue = useCallback((value: T) => update((current) => [{ id: (nextId.current += 1), value }, ...current]), [update]);
  const pushBack = useCallback((value: T, opts?: { preLiveFor?: number }) => update((current) => [
    ...current,
    { id: (nextId.current += 1), value, ...(opts?.preLiveFor !== undefined ? { preLiveFor: opts.preLiveFor } : {}) },
  ]), [update]);
  const takeFront = useCallback((): T | undefined => {
    const first = queueRef.current.find((item) => !item.draft);
    if (!first) return undefined;
    update((current) => current.filter((item) => item !== first));
    return first.value;
  }, [update]);

  // A draft's creation answered: ITS turns - and only its - leave the queue for the host to land, whatever chat is showing.
  useEffect(() => drafts.onOutcome((token, outcome) => {
    const mine = queueRef.current.filter((item) => item.draft?.token === token);
    if (mine.length === 0) return;
    update((current) => current.filter((item) => item.draft?.token !== token));
    landDraftRef.current?.(mine.map((item) => ({ value: item.value, followUp: item.draft!.followUp })), outcome);
  }), [drafts, update]);

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
  // goes to ITS conversation (`handOff`) - in order, nothing discarded. Turns held for a draft's creation are not this
  // chat's: they stay, untouched, for their own token's answer.
  const heldIn = useRef(resetKey);
  useEffect(() => {
    const from = heldIn.current;
    if (from === resetKey) return;
    heldIn.current = resetKey;
    const held = queueRef.current.filter((item) => !item.draft);
    if (held.length === 0) return;
    update((current) => current.filter((item) => item.draft));
    handOffRef.current?.(held, from);
  }, [resetKey, update]);

  const items = useMemo(() => queued.filter((item) => !item.draft || item.draft.token === shown), [queued, shown]);
  return { items, count: items.length, submit, remove, requeue, pushBack, takeFront, clear };
}
