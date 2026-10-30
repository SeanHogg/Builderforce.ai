'use client';

import { useCallback, useRef, type MutableRefObject } from 'react';
import { isRunning, stopRun } from './brainRunStore';

/**
 * The conversation's Stop, and the launches it must drop: a send is "getting ready" (persisting its row, the host's
 * `prepareRun`) before any run exists, and a Stop landing in that window has no run to stop - the launch is marked
 * cancelled instead, and `launch` aborts when it reaches the mark.
 *
 * A DRAFT's first send is the awkward one: it is keyed `null` while its chat is being created, then moves to the chat it
 * became (`draftMade`) while the person may still be LOOKING at the draft (`chatId` null). A Stop on that draft view is the
 * Stop of the conversation the send is making, so it reaches the chat the send resolved to as well - or the run would
 * start after the Stop, while the turns held behind it were dropped.
 */
export function useLaunchCancel(sendingRef: MutableRefObject<ReadonlySet<number | null>>) {
  /** Chats whose Stop came while a send was getting ready - its launch is dropped. `null` is a draft whose row is still being created; the mark moves to the chat it becomes. */
  const cancelledLaunchRef = useRef(new Set<number | null>());
  /** Chats with a launch (send, auto-reply or Retry) not yet started - a Stop drops it. */
  const launchingRef = useRef(new Set<number>());
  /** Chats a draft's first send created and has not finished with: a Stop on the draft view reaches them. */
  const draftMadeRef = useRef(new Set<number>());

  const stopChat = useCallback((id: number) => {
    // A send still getting ready has no run to stop yet: its launch is dropped instead.
    if ((sendingRef.current.has(id) || launchingRef.current.has(id)) && !isRunning(id)) cancelledLaunchRef.current.add(id);
    stopRun(id); // ...and what waits for the chat's run (the turns a draft's creation delivered) is dropped with it
  }, [sendingRef]);

  /** The Stop of the conversation showing `chatId` (null: a draft). */
  const stopConversation = useCallback((chatId: number | null) => {
    if (chatId != null) {
      stopChat(chatId);
      return;
    }
    // A draft's first send is still creating its chat: the launch is dropped once it has one.
    if (sendingRef.current.has(null)) cancelledLaunchRef.current.add(null);
    for (const made of draftMadeRef.current) stopChat(made);
  }, [stopChat, sendingRef]);

  return { cancelledLaunchRef, launchingRef, draftMadeRef, stopConversation };
}
