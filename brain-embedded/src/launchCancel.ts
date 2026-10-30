'use client';

import { useCallback, useRef, type MutableRefObject } from 'react';
import { isRunning, stopRun } from './brainRunStore';
import type { DraftToken } from './draftBinding';

/**
 * The conversation's Stop, and the launches it must drop: a send is "getting ready" (persisting its row, the host's
 * `prepareRun`) before any run exists, and a Stop landing in that window has no run to stop - the launch is marked
 * cancelled instead, and `launch` aborts when it reaches the mark.
 *
 * A DRAFT's send is the awkward one: it is keyed `null` while its chat is being created, then moves to the chat it
 * became while the person may still be LOOKING at the draft (`chatId` null). Each send from a draft owns one entry
 * (`DraftSend`) under the draft's DraftToken, and a Stop on the draft view names the token on screen: it reaches that
 * token's sends - and only their not-yet-started launches. A run that has STARTED is no longer the launch's to cancel:
 * the door stops it, token-scoped (`doorStop.ts`), and another draft's chat - live or not - is never touched.
 */
export interface DraftSend {
  token: DraftToken;
  /** `null` while the draft's chat is being created, then the chat the send moved to. */
  chat: number | null;
  /** A Stop reached this send before its run started: its launch drops (`launch` reads it, and a launch of another send on the same chat does not consume it). */
  cancelled: boolean;
}

export function useLaunchCancel(sendingRef: MutableRefObject<ReadonlySet<number | null>>) {
  /** Chats whose Stop came while a send was getting ready - its launch is dropped. `null` is a draft whose row is still being created; the mark moves to the chat it becomes. */
  const cancelledLaunchRef = useRef(new Set<number | null>());
  /** Chats with a launch (send, auto-reply or Retry) not yet started - a Stop drops it. */
  const launchingRef = useRef(new Set<number>());
  /** A draft's sends by token, one entry per SEND, until its run starts (or it ends). */
  const draftMadeRef = useRef(new Map<DraftToken, Set<DraftSend>>());

  /** A send starts from the draft `token`: its entry, while its chat is being created. */
  const beginDraftSend = useCallback((token: DraftToken): DraftSend => {
    const send: DraftSend = { token, chat: null, cancelled: false };
    const sends = draftMadeRef.current.get(token);
    if (sends) sends.add(send);
    else draftMadeRef.current.set(token, new Set([send]));
    return send;
  }, []);

  /** This send has reached its run (or ended): a Stop on the draft no longer cancels ITS launch. Others' entries stay. */
  const endDraftSend = useCallback((send: DraftSend) => {
    const sends = draftMadeRef.current.get(send.token);
    if (!sends) return;
    sends.delete(send);
    if (sends.size === 0) draftMadeRef.current.delete(send.token);
  }, []);

  const stopChat = useCallback((id: number) => {
    // A send still getting ready has no run to stop yet: its launch is dropped instead.
    if ((sendingRef.current.has(id) || launchingRef.current.has(id)) && !isRunning(id)) cancelledLaunchRef.current.add(id);
    stopRun(id); // ...and what waits for the chat's run (the turns a draft's creation delivered) is dropped with it
  }, [sendingRef]);

  /**
   * The Stop of the conversation showing `chatId` (null: a draft). `draft` is the draft on screen: a token, `null` for a
   * new draft with nothing sent from it (nothing to stop - another draft's launch is not this Stop's), `undefined` when
   * the host names no token and has no binding (its one creation is the draft).
   */
  const stopConversation = useCallback((chatId: number | null, draft?: DraftToken | null) => {
    if (chatId != null) {
      stopChat(chatId);
      return;
    }
    if (draft === null) return;
    const dropCreation = () => { if (sendingRef.current.has(null)) cancelledLaunchRef.current.add(null); };
    if (draft === undefined) {
      dropCreation();
      return;
    }
    // Every send under the token whose run has not started - its entry is still here (a run that starts ends its entry):
    // still creating (dropped once the chat exists), or made and getting ready. A started run is the door's token-scoped
    // `stopRun(made)`, never this; and another send's run on the same chat does not make this send "started".
    for (const send of draftMadeRef.current.get(draft) ?? []) {
      if (send.chat == null) dropCreation();
      else send.cancelled = true;
    }
  }, [stopChat, sendingRef]);

  return { cancelledLaunchRef, launchingRef, beginDraftSend, endDraftSend, stopConversation };
}
