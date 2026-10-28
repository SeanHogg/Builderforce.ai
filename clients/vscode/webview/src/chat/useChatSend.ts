/**
 * The ONE way a turn leaves the editor chat — typed, an answered question, or "Send
 * again": the per-turn limbic fetch, the held-turn queue behind a running run, and
 * steering a live sub-agent (or a run waiting on its sub-agents) instead of queueing.
 * Lifted out of the chat surface; the order of operations is unchanged.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useChatTurns, useRunRefreshTick, type BrainMessage, type ChatInputAttachment, type DirectedRecipient, type UseBrainConversation } from '@seanhogg/builderforce-brain-embedded';
import { request } from '../vscodeBridge';
import { childTarget, steerRun, type useChatChildren } from './chatChildren';
import type { QueuedTurn } from './VsCodeComposer';

/**
 * A fresh affective/personality block for THIS turn's text from the host (which appraises
 * it locally against the session's cached personality — the first turn of a session may
 * wait on that one personality fetch), with a short timeout so a slow/offline gateway
 * never stalls the send. Best-effort → '' on any failure.
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
  const pendingSendRef = useRef<{ text: string; recipient: DirectedRecipient | null; attachments?: ChatInputAttachment[] } | null>(null);
  const [sendNonce, setSendNonce] = useState(0);
  useEffect(() => {
    if (sendNonce === 0) return;
    const queued = pendingSendRef.current;
    if (!queued) return;
    pendingSendRef.current = null;
    // Restore the typed text if the send fails before it's persisted (e.g. the token
    // expired) so the user's message is never silently lost. `addressedTo` routes the
    // turn: a participant is talked to (no BRAIN run); null (default) runs the BRAIN.
    // A held turn carries its OWN attachment snapshot (the composer was cleared when the
    // turn queued), passed explicitly so the images survive the wait.
    const sending = conv.send(queued.text, { addressedTo: queued.recipient, ...(queued.attachments ? { attachments: queued.attachments } : {}) });
    // Cleared only now, in the same commit as `conv.sending`, so the turn door never sees
    // a gap between staging and sending (its queue would flush a held turn into it).
    setPreparing(false);
    void sending.then((ok) => {
      if (!ok) setInput((cur) => cur || queued.text);
    });
    // Keyed only on the nonce: `conv` is read fresh from this render's closure, which
    // already carries the just-set turnLimbic in its system prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendNonce]);

  // Fetch this turn's limbic block, fold it into extraSystem, THEN stage the send.
  // Shared by the direct composer submit AND the queue drain below. Attachments ride
  // in `pendingSendRef` (already detached from the composer), so `conv.send`'s own
  // snapshot+clear of `pendingAttachments` never sees them twice.
  // The fetch takes up to 4 s before `conv.send` even starts, so the turn counts as in
  // flight meanwhile: a Stop (button or typed) in that window drops the send.
  const [preparing, setPreparing] = useState(false);
  const stopPreparingRef = useRef(false);
  const dispatchSend = useCallback(async (text: string, to: DirectedRecipient | null, attachments?: ChatInputAttachment[]) => {
    stopPreparingRef.current = false;
    setPreparing(true);
    const block = await requestLimbic(text);
    if (stopPreparingRef.current) {
      // Stopped while it got ready: nothing was sent — the words go back to the composer.
      setPreparing(false);
      setInput((cur) => cur || text);
      return;
    }
    setTurnLimbic(block);
    pendingSendRef.current = { text, recipient: to, attachments };
    setSendNonce((n) => n + 1);
  }, [setInput, setTurnLimbic]);

  // THE ONE turn door (shared): steer → queue while a run is in flight → send. Calling
  // `conv.send` directly is what lost answers — it refuses while the chat is running and
  // says nothing (chat #133). The queue is FIFO, one per completed run (each stays a
  // distinct steerable turn), never flushed across a chat switch, and cleared with it.
  const turns = useChatTurns<QueuedTurn>({
    running: conv.sending || preparing,
    runKey: chatId,
    send: (m) => dispatchSend(m.text, m.recipient, m.attachments),
    textOf: (m) => m.text,
    // A turn for a participant is a message to them — never the Brain's Stop.
    isDirected: (m) => m.recipient != null,
    // The conversation's Stop: it also drops a launch still getting ready — and a send
    // still fetching its limbic block.
    stop: () => {
      stopPreparingRef.current = true;
      conv.stop();
    },
    // The editor's steer: a live sub-agent takes its message straight into its run, and
    // the chat's own RUNNING run is spoken to now (PRD 35 E10) — the message interrupts
    // the step in flight and reaches the next model call, instead of waiting behind a run
    // that may hold for minutes. A stop command ("STOP executing") stops it (the host
    // reads that). Holding it for after the run is the explicit alternative: `queueAfter`.
    steer: ({ text, recipient: to, attachments }) => {
      const child = childTarget(text, to, liveChildren);
      if (!child && !(conv.sending && !to && chatId != null)) return false;
      // Reaching here means we WILL steer (a live sub-agent or the running chat run),
      // and the steer path bypasses `conv.send` — which is what normally snapshots +
      // clears `pendingAttachments`. The turn already carries its own attachment
      // snapshot (taken at submit, before the composer's clear), so ride it along
      // explicitly or a mid-run image would be silently dropped.
      const atts = attachments ?? [];
      if (child) steerRun(child.key, text, atts);
      else steerRun(chatId as number, text, atts);
      return true;
    },
  });
  const { submit: submitTurn } = turns;
  const { submit: holdTurn } = turns.queued;

  // A run moves what the chat row reports (its spend & savings, ticket counts), and the
  // host drives the run, so the in-page loop's `onActivity` never sees it: re-read the row
  // on the shared beat — as the run goes, and once when it settles.
  const refreshTick = useRunRefreshTick(conv.sending);
  useEffect(() => {
    if (refreshTick > 0) reloadChats();
  }, [refreshTick, reloadChats]);

  // Snapshot the composer's pending attachments onto THIS turn. `conv.send` clears the
  // composer when a turn actually goes out, but a held turn waits behind a running run —
  // and the steer path clears the composer at queue time — so by drain time the live
  // snapshot is gone. Each turn carries its own copy so its images survive the wait.
  // Keyed on the two fields it reads, never on `conv`: that object is new every render,
  // and this identity flows into `answerQuestion` / `replayMessage` — the transcript's
  // props — so keying on it re-rendered every visible row on each keystroke and frame.
  const { pendingAttachments, removeAttachment } = conv;
  const takeAttachments = useCallback((): ChatInputAttachment[] => {
    const attachments = [...pendingAttachments];
    for (const a of attachments) removeAttachment(a.key);
    return attachments;
  }, [pendingAttachments, removeAttachment]);

  const sendOrQueue = useCallback((text: string, to: DirectedRecipient | null, attachments?: ChatInputAttachment[]) => {
    void submitTurn({ text, recipient: to, attachments: attachments ?? takeAttachments() });
  }, [submitTurn, takeAttachments]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendOrQueue(text, recipient);
  }, [input, recipient, sendOrQueue, setInput]);

  // The explicit "Queue for after": hold the typed message until the run finishes
  // (sent on its falling edge); with no run going it is simply sent.
  const queueAfter = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    // Take the snapshot ONCE — if `holdTurn` refuses (no run to wait for), the same
    // attachments go to the immediate send; taking them again would see an empty composer.
    const attachments = takeAttachments();
    if (!holdTurn({ text, recipient, attachments })) sendOrQueue(text, recipient, attachments);
  }, [holdTurn, input, recipient, sendOrQueue, setInput, takeAttachments]);

  // Answering an ask_user card posts the chosen option(s) as the user's next turn.
  const answerQuestion = useCallback((answer: string) => {
    sendOrQueue(answer, recipient);
  }, [recipient, sendOrQueue]);

  // "Send again" on any transcript message — queues behind a running turn like a typed one.
  const replayMessage = useCallback((message: BrainMessage) => {
    sendOrQueue(message.content, recipient);
  }, [recipient, sendOrQueue]);

  // `stop` clears the held turns AND stops the chat's run — the composer's Stop.
  return { queued: turns.queued, stop: turns.stop, submit, queueAfter, answerQuestion, replayMessage };
}
