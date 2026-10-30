'use client';

import { useCallback, useRef, type MutableRefObject } from 'react';
import { isRunning, stopRun } from './brainRunStore';
import type { DraftToken } from './draftBinding';

/**
 * The conversation's Stop, and the launches it must drop: a send is "getting ready" (persisting its row, the host's
 * `prepareRun`) before any run exists, and a Stop landing in that window has no run to stop - the launch is marked
 * cancelled instead, and `launch` aborts when it reaches the mark.
 *
 * A DRAFT's first send is the awkward one: it is keyed `null` while its chat is being created, then moves to the chat it
 * became while the person may still be LOOKING at the draft (`chatId` null). The send is remembered by its DraftToken
 * (`draftMade`), and a Stop on the draft view names the token on screen: it reaches that draft's send - and only its
 * not-yet-started launch. A run that has STARTED is no longer the launch's to cancel: the door stops it, token-scoped
 * (`doorStop.ts`), and another draft's chat - live or not - is never touched.
 */
export function useLaunchCancel(sendingRef: MutableRefObject<ReadonlySet<number | null>>) {
  /** Chats whose Stop came while a send was getting ready - its launch is dropped. `null` is a draft whose row is still being created; the mark moves to the chat it becomes. */
  const cancelledLaunchRef = useRef(new Set<number | null>());
  /** Chats with a launch (send, auto-reply or Retry) not yet started - a Stop drops it. */
  const launchingRef = useRef(new Set<number>());
  /** A draft's first send by token: `null` while its chat is being created, then the chat it made - until its run starts. */
  const draftMadeRef = useRef(new Map<DraftToken, number | null>());

  /** The send of `chat` has reached its run (or ended): a Stop on the draft no longer cancels a launch. */
  const releaseDraftMade = useCallback((chat: number) => {
    for (const [token, made] of draftMadeRef.current) if (made === chat) draftMadeRef.current.delete(token);
  }, []);

  const stopChat = useCallback((id: number) => {
    // A send still getting ready has no run to stop yet: its launch is dropped instead.
    if ((sendingRef.current.has(id) || launchingRef.current.has(id)) && !isRunning(id)) cancelledLaunchRef.current.add(id);
    stopRun(id); // ...and what waits for the chat's run (the turns a draft's creation delivered) is dropped with it
  }, [sendingRef]);

  /** The Stop of the conversation showing `chatId` (null: a draft - `draft` is the one on screen). */
  const stopConversation = useCallback((chatId: number | null, draft?: DraftToken | null) => {
    if (chatId != null) {
      stopChat(chatId);
      return;
    }
    // A draft Stop reaches the draft on screen alone. A host that names no token has no entry to look up: its one creation.
    if (draft == null) {
      if (sendingRef.current.has(null)) cancelledLaunchRef.current.add(null);
      return;
    }
    if (!draftMadeRef.current.has(draft)) return;
    const made = draftMadeRef.current.get(draft);
    // Still creating: the launch is dropped once the chat exists.
    if (made == null) {
      if (sendingRef.current.has(null)) cancelledLaunchRef.current.add(null);
      return;
    }
    // Made, launch not started: dropped. Started: the door's token-scoped `stopRun(made)` ends it - never this.
    if ((sendingRef.current.has(made) || launchingRef.current.has(made)) && !isRunning(made)) cancelledLaunchRef.current.add(made);
  }, [stopChat, sendingRef]);

  return { cancelledLaunchRef, launchingRef, draftMadeRef, releaseDraftMade, stopConversation };
}
