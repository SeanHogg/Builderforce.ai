/**
 * The ONE way a turn leaves the editor chat — typed, an answered question, or "Send
 * again": the per-turn limbic fetch, the held-turn queue behind a running run, and
 * steering a live sub-agent (or a run waiting on its sub-agents) instead of queueing.
 * Lifted out of the chat surface; the order of operations is unchanged.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useChatTurns, useRunRefreshTick, type BrainMessage, type DirectedRecipient, type UseBrainConversation } from '@seanhogg/builderforce-brain-embedded';
import { request } from '../vscodeBridge';
import { childTarget, isWaitingOnSubagents, steerRun, type useChatChildren } from './chatChildren';
import type { QueuedTurn } from './VsCodeComposer';

/**
 * Fetch a fresh affective/personality block for THIS turn's text from the host (which
 * calls the gateway), with a short timeout so a slow/offline gateway never stalls the
 * send. Best-effort → '' on any failure.
 */
async function requestLimbic(text: string): Promise<string> {
  try {
    const r = await Promise.race([
      request<{ block?: string }>('fetchLimbic', { text }),
      new Promise<{ block?: string }>((res) => window.setTimeout(() => res({}), 4000)),
    ]);
    return r?.block ?? '';
  } catch {
    return '';
  }
}

export function useChatSend({ conv, chatId, input, setInput, recipient, liveChildren, setTurnLimbic, reloadChats }: {
  conv: UseBrainConversation;
  chatId: number | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  recipient: DirectedRecipient | null;
  liveChildren: ReturnType<typeof useChatChildren>;
  setTurnLimbic: (block: string) => void;
  reloadChats: () => void;
}) {
  // A send queued behind its per-turn limbic fetch. We can't call conv.send
  // synchronously in submit(): the fresh limbic block must land in extraSystem (→ the
  // run request's system prompt) FIRST. So the send fetches the block, sets turnLimbic +
  // bumps this nonce, and the effect runs the send on the NEXT render — where `conv`
  // already reflects the new system prompt. This is the webview's per-turn limbic seam.
  const pendingSendRef = useRef<{ text: string; recipient: DirectedRecipient | null } | null>(null);
  const [sendNonce, setSendNonce] = useState(0);
  useEffect(() => {
    if (sendNonce === 0) return;
    const queued = pendingSendRef.current;
    if (!queued) return;
    pendingSendRef.current = null;
    // Restore the typed text if the send fails before it's persisted (e.g. the token
    // expired) so the user's message is never silently lost. `addressedTo` routes the
    // turn: a participant is talked to (no BRAIN run); null (default) runs the BRAIN.
    void conv.send(queued.text, { addressedTo: queued.recipient }).then((ok) => {
      if (!ok) setInput((cur) => cur || queued.text);
    });
    // Keyed only on the nonce: `conv` is read fresh from this render's closure, which
    // already carries the just-set turnLimbic in its system prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendNonce]);

  // Fetch this turn's limbic block, fold it into extraSystem, THEN stage the send.
  // Shared by the direct composer submit AND the queue drain below.
  const dispatchSend = useCallback(async (text: string, to: DirectedRecipient | null) => {
    const block = await requestLimbic(text);
    setTurnLimbic(block);
    pendingSendRef.current = { text, recipient: to };
    setSendNonce((n) => n + 1);
  }, [setTurnLimbic]);

  // THE ONE turn door (shared): steer → queue while a run is in flight → send. Calling
  // `conv.send` directly is what lost answers — it refuses while the chat is running and
  // says nothing (chat #133). The queue is FIFO, one per completed run (each stays a
  // distinct steerable turn), never flushed across a chat switch, and cleared with it.
  const turns = useChatTurns<QueuedTurn>({
    running: conv.sending,
    runKey: chatId,
    send: (m) => dispatchSend(m.text, m.recipient),
    textOf: (m) => m.text,
    // The editor's steer: a live sub-agent takes its message straight into its run, and
    // a chat run waiting on its sub-agents is spoken to now (the wait gives way and its
    // next turn answers) rather than queued behind a run that may hold for minutes.
    steer: ({ text, recipient: to }) => {
      const child = childTarget(text, to, liveChildren);
      if (child) {
        steerRun(child.key, text);
        return true;
      }
      if (conv.sending && !to && chatId != null && isWaitingOnSubagents(conv.activity)) {
        steerRun(chatId, text);
        return true;
      }
      return false;
    },
  });
  const { submit: submitTurn } = turns;

  // A run moves what the chat row reports (its spend & savings, ticket counts), and the
  // host drives the run, so the in-page loop's `onActivity` never sees it: re-read the row
  // on the shared beat — as the run goes, and once when it settles.
  const refreshTick = useRunRefreshTick(conv.sending);
  useEffect(() => {
    if (refreshTick > 0) reloadChats();
  }, [refreshTick, reloadChats]);

  const sendOrQueue = useCallback((text: string, to: DirectedRecipient | null) => {
    void submitTurn({ text, recipient: to });
  }, [submitTurn]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendOrQueue(text, recipient);
  }, [input, recipient, sendOrQueue, setInput]);

  // Answering an ask_user card posts the chosen option(s) as the user's next turn.
  const answerQuestion = useCallback((answer: string) => {
    sendOrQueue(answer, recipient);
  }, [recipient, sendOrQueue]);

  // "Send again" on any transcript message — queues behind a running turn like a typed one.
  const replayMessage = useCallback((message: BrainMessage) => {
    sendOrQueue(message.content, recipient);
  }, [recipient, sendOrQueue]);

  // `stop` clears the held turns AND stops the chat's run — the composer's Stop.
  return { queued: turns.queued, stop: turns.stop, submit, answerQuestion, replayMessage };
}
