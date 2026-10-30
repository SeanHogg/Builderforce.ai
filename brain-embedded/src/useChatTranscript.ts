/**
 * A chat's TRANSCRIPT as a conversation surface holds it: loaded for the chat on screen,
 * merged with what a live run appended, re-read when the host says the chat changed, and
 * marked read up to its newest message. Split out of `useBrainConversation` (one reason
 * to change: how the durable message list is held), which keeps the send / run / ratings
 * logic.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainPersistenceAdapter } from './config';
import { mergeTranscript } from './mergeTranscript';
import { replayPendingWords } from './pendingWords';
import { getRunSnapshot, type BrainRunSnapshot } from './brainRunStore';
import type { BrainMessage } from './types';

/** The list a chat reads before its own has loaded — one identity, so effects keyed on
 *  `messages` do not re-fire on every render of that window. */
const NO_MESSAGES: BrainMessage[] = [];

export interface ChatTranscriptCallbacks {
  /** A load started — the surface clears a stale load error. */
  onLoadStart: () => void;
  /** A load failed. */
  onLoadError: (message: string) => void;
}

export function useChatTranscript(
  persistence: BrainPersistenceAdapter,
  chatId: number | null,
  snapshot: Pick<BrainRunSnapshot, 'appended' | 'messagesEpoch'>,
  callbacks: ChatTranscriptCallbacks,
) {
  // Read through a ref: the load effect must not re-run because a callback changed identity.
  const cb = useRef(callbacks);
  cb.current = callbacks;
  // The transcript is held TOGETHER WITH the chat it was loaded for, and read only for
  // that chat. One instance serves a panel that walks between chats, and React applies
  // the switch's new `chatId` a render before the reload's state lands: a bare list let
  // that render read the PREVIOUS chat's messages under the NEW chat's id. The
  // auto-reply below then found the old chat's trailing user row (a steer sent into
  // its live run) and started a run in the chat just switched to — an "only do analysis"
  // typed in one chat stopped a different chat's work. Every write names its chat and
  // is dropped when that is no longer the one held.
  const [held, setHeld] = useState<{ chatId: number | null; list: BrainMessage[] }>({ chatId, list: [] });
  const messages = held.chatId === chatId ? held.list : NO_MESSAGES;
  const updateMessages = useCallback((forChat: number | null, update: (prev: BrainMessage[]) => BrainMessage[]) => {
    setHeld((cur) => (cur.chatId === forChat ? { chatId: forChat, list: update(cur.list) } : cur));
  }, []);
  const [loadingMessages, setLoadingMessages] = useState(false);
  // Bumped by reloadMessages() to force a transcript refetch without changing the
  // chat id — e.g. after another chat is merged INTO this one server-side.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadMessages = useCallback(() => setReloadNonce((n) => n + 1), []);
  // Load messages whenever the active chat changes.
  useEffect(() => {
    let cancelled = false;
    if (chatId == null) {
      setHeld({ chatId: null, list: [] });
      return;
    }
    setLoadingMessages(true);
    cb.current.onLoadStart();
    // Words an EARLIER page load left unsaved are saved first (idempotent on their keys), so they are in this read.
    replayPendingWords(chatId, persistence)
      .then(() => persistence.getMessages(chatId))
      .then((list) => {
        // MERGE, never replace: a run that persisted its reply hands it over through
        // the run store's `appended` buffer, and this fetch can resolve after that
        // splice. Replacing would drop the turn, and the splice effect below will not
        // re-fire to restore it (its epoch has not moved). See `mergeTranscript`.
        if (!cancelled) setHeld({ chatId, list: mergeTranscript(list, getRunSnapshot(chatId).appended) });
      })
      .catch((e) => {
        if (!cancelled) cb.current.onLoadError(e instanceof Error ? e.message : 'Failed to load messages');
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => { cancelled = true; };
  }, [persistence, chatId, reloadNonce]);

  // Agent lifecycle messages are written outside this browser's run store. Subscribe
  // to the host's chat invalidation channel and re-read durable state on each push.
  useEffect(() => {
    if (chatId == null || !persistence.subscribeMessages) return;
    return persistence.subscribeMessages(chatId, reloadMessages);
  }, [persistence, chatId, reloadMessages]);

  // Mark the OPEN chat read up to its newest message, so the unread badge a
  // background chat shows (an execution milestone / teammate turn that landed while
  // you were elsewhere) clears the moment you view it — on BOTH surfaces, since it
  // marks the same server chat. Fires whenever the mounted chat's high-water seq
  // advances (initial load, each `changed` push, an in-run append). Only ever moves
  // forward (ref guard) so it doesn't spam the endpoint on every re-render.
  const lastMarkedRef = useRef<{ chatId: number; seq: number } | null>(null);
  useEffect(() => {
    if (chatId == null || !persistence.markChatRead || messages.length === 0) return;
    let maxSeq = 0;
    for (const m of messages) if (m.seq > maxSeq) maxSeq = m.seq;
    if (maxSeq <= 0) return;
    const prev = lastMarkedRef.current;
    if (prev && prev.chatId === chatId && prev.seq >= maxSeq) return;
    lastMarkedRef.current = { chatId, seq: maxSeq };
    void persistence.markChatRead(chatId, maxSeq).catch(() => {
      // Best-effort: a failed mark just means the badge clears on the next open.
      if (lastMarkedRef.current?.chatId === chatId) lastMarkedRef.current = prev;
    });
  }, [persistence, chatId, messages]);

  // A run (possibly started in another, now-unmounted Brain instance) persisted
  // assistant messages — splice them in without a refetch. The store delivers
  // the FULL run-appended list (narration turns + final answer), not just the
  // latest, and we merge by id: React coalesces the rapid mid-run emits into one
  // render, so a "last value only" hand-off would drop the intermediate
  // narration turns and the next turn's stream would appear to erase them. Keyed
  // on messagesEpoch so it fires once per completed turn for EVERY mounted
  // instance, not just the one that drove the loop.
  useEffect(() => {
    const appended = snapshot.appended;
    if (appended.length === 0) return;
    updateMessages(chatId, (prev) => mergeTranscript(prev, appended));
  }, [snapshot.messagesEpoch, snapshot.appended, chatId, updateMessages]);

  return { messages, updateMessages, loadingMessages, reloadMessages };
}
