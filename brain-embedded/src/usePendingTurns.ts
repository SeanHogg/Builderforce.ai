'use client';

/**
 * The turn the person just SENT, shown before it is saved.
 *
 * A send persists the user's row first (`persistence.sendMessages`) and the transcript shows nothing until that
 * returns - on a slow store that is seconds in which the message seems lost. This is the optimistic row: opened
 * synchronously as the send starts (or, for a host with a pre-send stage, as the box is submitted - `announceTurn`),
 * closed in the same state update that appends the persisted row, and on EVERY failure path (a failed send gives the
 * turn back to the composer, so it must not also stay on screen).
 *
 * Held per chat, because one hook instance serves a panel that walks between chats and a send outlives a switch: a
 * turn sent in chat A never shows in chat B, and a draft chat's slot (key `null`) follows the id its first send creates.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { BrainMessage, ChatInputAttachment } from './types';
import type { RunServedBy } from './runStore/runSnapshotTypes';

/** A sent turn that has not landed in the transcript yet. */
export interface PendingTurn {
  /** What the person typed (trimmed) - the transcript draws it like the persisted row it is about to become. */
  text: string;
  /** The turn's own files, when it carries any. */
  attachments?: ChatInputAttachment[];
}

export interface PendingSlot extends PendingTurn {
  /** The ids the chat already held when the turn was sent: a row that is not among them is what the turn became. */
  seen: ReadonlySet<number>;
}

const NO_SLOTS: ReadonlyMap<number | null, PendingSlot> = new Map();

/**
 * The slot as the transcript should draw it: null once its row is in `messages` (a reload or a pushed change can
 * land the saved row before the send's own append does - drawing both would double the bubble).
 */
export function pendingTurnShown(slot: PendingSlot | undefined, messages: readonly BrainMessage[]): PendingTurn | null {
  if (!slot) return null;
  const landed = messages.some((m) => m.role === 'user' && !slot.seen.has(m.id) && m.content.includes(slot.text));
  if (landed) return null;
  return { text: slot.text, ...(slot.attachments?.length ? { attachments: slot.attachments } : {}) };
}

export interface PendingTurns {
  /** The open chat's pending turn, or null. */
  pendingTurn: PendingTurn | null;
  /**
   * Show a turn at SUBMIT, before `send` is called - for a host whose send waits on its own pre-send stage
   * (the editor's per-turn limbic fetch). `null` withdraws it (the stage said the send is not going: stopped,
   * or another chat is showing). `opts.chat` names the chat it was announced in when that is no longer the one
   * showing; absent, the chat showing WHEN THE CALL RUNS takes it (a send outlives a switch). `send` takes it over.
   */
  announceTurn?(text: string | null, opts?: { chat?: number | null }): void;
  /**
   * The model doing this run's work, as the stream named it - from the moment the turn's route is known, kept
   * through the tool steps. Undefined before that: the transcript never shows a guess. Surfaced HERE (not beside
   * the run snapshot) so the "what is answering me" state is colocated with the just-sent turn it answers.
   */
  servedBy?: RunServedBy;
  /** Open `chat`'s slot for `text` (a no-op when it already holds exactly that). */
  open(chat: number | null, text: string, attachments?: readonly ChatInputAttachment[]): void;
  /** Close `chat`'s slot. */
  close(chat: number | null): void;
  /** The draft's slot became chat `to` (the first send created it). */
  rekey(from: number | null, to: number): void;
}

export interface UsePendingTurnsOptions {
  /**
   * The chat showing NOW, read at CALL time by `announceTurn` (not render time): an announced turn belongs to
   * the conversation the user was in when they submitted, even when a switch lands mid-stage.
   */
  currentChat?: () => number | null;
  /** The run snapshot's `servedBy` (`useRunSnapshot`), surfaced on the return next to `pendingTurn`. */
  servedBy?: RunServedBy;
}

export function usePendingTurns(
  chatId: number | null,
  messages: readonly BrainMessage[],
  options?: UsePendingTurnsOptions,
): PendingTurns {
  const [slots, setSlots] = useState(NO_SLOTS);
  // The ids the open chat holds NOW, read when a slot opens (the opening chat IS the one showing: a send starts there).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // `announceTurn` resolves the chat at CALL time through this, so it never writes a turn into the conversation
  // the user moved to while the host's pre-send stage ran.
  const currentChatRef = useRef(options?.currentChat);
  currentChatRef.current = options?.currentChat;

  const open = useCallback((chat: number | null, text: string, attachments?: readonly ChatInputAttachment[]) => {
    setSlots((cur) => {
      const have = cur.get(chat);
      if (have && have.text === text) return cur;
      const next = new Map(cur);
      next.set(chat, {
        text,
        ...(attachments && attachments.length > 0 ? { attachments: [...attachments] } : {}),
        seen: new Set(messagesRef.current.map((m) => m.id)),
      });
      return next;
    });
  }, []);
  const close = useCallback((chat: number | null) => {
    setSlots((cur) => {
      if (!cur.has(chat)) return cur;
      const next = new Map(cur);
      next.delete(chat);
      return next;
    });
  }, []);
  const rekey = useCallback((from: number | null, to: number) => {
    setSlots((cur) => {
      const slot = cur.get(from);
      if (!slot) return cur;
      const next = new Map(cur);
      next.delete(from);
      next.set(to, slot);
      return next;
    });
  }, []);

  // The pre-send seam, colocated with the slots it opens: `useBrainConversation` used to own this callback; the
  // knowledge of WHICH chat a turn was announced into belongs with the slot map, not the conversation hook.
  const announceTurn = useCallback((text: string | null, opts?: { chat?: number | null }) => {
    const chat = opts && 'chat' in opts ? (opts.chat ?? null) : (currentChatRef.current?.() ?? null);
    if (text == null) close(chat);
    else open(chat, text.trim());
  }, [open, close]);

  const slot = slots.get(chatId);
  const pendingTurn = useMemo(() => pendingTurnShown(slot, messages), [slot, messages]);
  return { pendingTurn, announceTurn, servedBy: options?.servedBy, open, close, rekey };
}
