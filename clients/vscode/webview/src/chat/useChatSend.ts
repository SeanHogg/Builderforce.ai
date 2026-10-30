/**
 * The ONE way a turn leaves the editor chat — typed, an answered question, or "Send
 * again": the per-turn limbic fetch, the held-turn queue behind a running run, and
 * steering a live sub-agent (or a run waiting on its sub-agents) instead of queueing.
 * Lifted out of the chat surface; the order of operations is unchanged.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { chatDoorLiveness, joinRestorableTurns, restoreTurn, useChatTurns, useComposerDraft, useRunRefreshTick, type BrainMessage, type ChatTurns, type ChatInputAttachment, type DirectedRecipient, type DraftBinding, type SendContext, type UseBrainConversation } from '@seanhogg/builderforce-brain-embedded';
import { request } from '../vscodeBridge';
import { stageSend, stopReaches, type SendStage } from './stageSend';
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

export function useChatSend({ conv, chatId, drafts, input, setInput, recipient, chooseRecipient, liveChildren, setTurnLimbic, reloadChats }: {
  conv: UseBrainConversation;
  chatId: number | null;
  /** The draft's binding to its creation (`useVsCodeChats().drafts`): turns typed while the first send creates the chat land in THAT chat. */
  drafts?: DraftBinding;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  recipient: DirectedRecipient | null;
  /** Point the composer at a participant again (`useRecipientChoice().choose`) - a restored addressed turn keeps its addressee. */
  chooseRecipient: (to: DirectedRecipient | null) => void;
  liveChildren: ReturnType<typeof useChatChildren>;
  setTurnLimbic: (block: string) => void;
  reloadChats: () => void;
}) {
  // A send queued behind its per-turn limbic fetch. We can't call conv.send
  // synchronously in submit(): the fresh limbic block must land in extraSystem (→ the
  // run request's system prompt) FIRST. So the send fetches the block, sets turnLimbic +
  // bumps this nonce, and the effect runs the send on the NEXT render — where `conv`
  // already reflects the new system prompt. This is the webview's per-turn limbic seam.
  const pendingSendRef = useRef<{
    text: string; recipient: DirectedRecipient | null; attachments?: ChatInputAttachment[];
    /** How the door hears whether the send was kept, and where it was typed in (the chat, and the draft token of a send from a draft) - with the Stop's mark. */
    done: (kept: boolean) => void; stage: SendStage;
  } | null>(null);
  const [sendNonce, setSendNonce] = useState(0);
  const chatIdRef = useRef(chatId);
  // eslint-disable-next-line react-hooks/refs
  chatIdRef.current = chatId;
  const composer = useComposerDraft(input, setInput);
  useEffect(() => {
    if (sendNonce === 0) return;
    const queued = pendingSendRef.current;
    if (!queued) return;
    pendingSendRef.current = null;
    stagesRef.current.delete(queued.stage);
    // A Stop that landed between staging and this commit drops the send like one during the fetch.
    if (queued.stage.stopped) {
      setPreparing(false);
      // A send from a draft is put back by the door (its token fails: nothing was created) - one restore with whatever was
      // held behind it; any other is put back here and reported kept.
      if (queued.stage.draft === undefined) giveBack({ text: queued.text, recipient: queued.recipient, attachments: queued.attachments });
      queued.done(queued.stage.draft === undefined);
      return;
    }
    // `addressedTo` routes the turn: a participant is talked to (no BRAIN run); null (default)
    // runs the BRAIN. A held turn carries its OWN attachment snapshot (the composer was cleared
    // when the turn queued), passed explicitly so the images survive the wait. Never into a chat the
    // person has since switched to: that is another chat's turn.
    const sending = chatIdRef.current === queued.stage.chat
      ? conv.send(queued.text, { addressedTo: queued.recipient, ...(queued.attachments ? { attachments: queued.attachments } : {}), ...(queued.stage.draft !== undefined ? { draft: queued.stage.draft } : {}) })
      : Promise.resolve(false);
    // Cleared only now, in the same commit as `conv.sending`, so the turn door never sees
    // a gap between staging and sending (its queue would flush a held turn into it).
    setPreparing(false);
    // Whether it was kept goes back to the door (the real answer, not an assumed one): a turn that
    // was not kept is restored by whoever sent it - the queue's flush, or `sendOrQueue` below.
    void sending.then(queued.done);
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
  const { restoreAttachments } = conv;
  const [preparing, setPreparing] = useState(false);
  // The sends getting ready, each with its own mark: a Stop sets it only on the sends it reaches (`stopReaches`).
  const stagesRef = useRef(new Set<SendStage>());
  // A turn that could not go goes back to the box: text, files and addressee - THE restore every host shares.
  const giveBack = useCallback((m: QueuedTurn) => restoreTurn(m, { draft: composer.draft, setInput: composer.setInput, restoreAttachments, chooseRecipient }), [composer, restoreAttachments, chooseRecipient]);
  const dispatchSend = useCallback(async (m: QueuedTurn, ctx?: SendContext): Promise<boolean> => {
    const { text, recipient: to, attachments } = m;
    setPreparing(true);
    const startedIn = chatIdRef.current;
    const stage: SendStage = { chat: startedIn, draft: ctx?.draft, stopped: false };
    stagesRef.current.add(stage);
    const staged = await stageSend({ startedIn, currentChat: () => chatIdRef.current, stopped: () => stage.stopped, fetchBlock: () => requestLimbic(text) });
    if (!staged.ready) {
      stagesRef.current.delete(stage);
      setPreparing(false);
      if (staged.why === 'stopped') {
        // Stopped while it got ready: nothing was sent - the words and the files go back to the box, and the
        // Stop has already dropped the queue, so this is the turn's one restore. (From a draft the door does it: below.)
        if (ctx?.draft !== undefined) return false;
        giveBack(m);
        return true;
      }
      // Another chat is showing: not sent. A send from a draft is the door's to put back, with what was held behind it, in ONE
      // restore; any other, the caller returns to the box that is showing.
      return false;
    }
    setTurnLimbic(staged.block);
    return new Promise<boolean>((done) => {
      pendingSendRef.current = { text, recipient: to, attachments, done, stage };
      setSendNonce((n) => n + 1);
    });
  }, [setTurnLimbic, giveBack]);

  // THE ONE turn door (shared): steer → queue while a run is in flight → send. Calling
  // `conv.send` directly is what lost answers — it refuses while the chat is running and
  // says nothing (chat #133). The queue is FIFO, one per completed run (each stays a
  // distinct steerable turn), never flushed across a chat switch, and cleared with it.
  const turns: ChatTurns<QueuedTurn> = useChatTurns<QueuedTurn>({
    // In flight from the start of the limbic fetch (a turn typed then is HELD behind it); steerable only
    // while the run store says the run is live - one source, the same one the Send label reads.
    ...chatDoorLiveness(conv, preparing),
    // A turn not kept after the chat changed (addressed, or any - the run executes in the host, so the
    // webview's inbox is read by nobody) returns to the box with its addressee.
    restore: giveBack,
    // Everything held when the person moved to another chat comes back as ONE turn (the box holds one draft).
    join: (held) => {
      const one = joinRestorableTurns(held);
      return { text: one.text, recipient: one.recipient, ...(one.attachments?.length ? { attachments: [...one.attachments] } : {}) };
    },
    runKey: chatId,
    drafts,
    send: dispatchSend,
    textOf: (m) => m.text,
    // A turn for a participant is a message to them — never the Brain's Stop.
    isDirected: (m) => m.recipient != null,
    // The conversation's Stop: it also drops a launch still getting ready — and a send
    // still fetching its limbic block.
    stop: (draft) => {
      // Only the sends this Stop reaches: the chat showing's, or the showing draft's - never another draft's.
      for (const stage of stagesRef.current) if (stopReaches(stage, chatIdRef.current, draft)) stage.stopped = true;
      conv.stop(draft);
    },
    // The editor's steer: a live sub-agent takes its message straight into its run, and
    // the chat's own RUNNING run is spoken to now (PRD 35 E10) — the message interrupts
    // the step in flight and reaches the next model call, instead of waiting behind a run
    // that may hold for minutes. A stop command ("STOP executing") stops it (the host
    // reads that). Holding it for after the run is the explicit alternative: `queueAfter`.
    steer: ({ text, recipient: to, attachments }) => {
      const child = childTarget(text, to, liveChildren);
      // The door's own predicate - the one the Send label reads (a turn behind one held with Alt+Enter,
      // or carrying a file a steer would drop, waits its turn; nothing steers before the run is live) -
      // so the label and the turn cannot disagree.
      const steersOwnRun = !to && turns.steers({ directed: false, attachments });
      // A message to a live sub-agent goes in whole: a file a steer would drop (anything but a
      // picture) holds the message for after instead of being lost.
      const atts = attachments ?? [];
      if (child && !atts.every((a) => !!a.imageUrl)) return false;
      if (!child && !steersOwnRun) return false;
      // Reaching here means we WILL steer (a live sub-agent or the running chat run),
      // and the steer path bypasses `conv.send` — which is what normally snapshots +
      // clears `pendingAttachments`. The turn already carries its own attachment
      // snapshot (taken at submit, before the composer's clear), so ride it along
      // explicitly or a mid-run image would be silently dropped.
      if (child) steerRun(child.key, text, atts);
      else steerRun(chatId as number, text, atts);
      return true;
    },
  });
  const { submit: submitTurn, queueAfter: queueTurnAfter } = turns;

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
  const composerFiles = pendingAttachments;
  const takeAttachments = useCallback((): ChatInputAttachment[] => {
    const attachments = [...pendingAttachments];
    for (const a of attachments) removeAttachment(a.key);
    return attachments;
  }, [pendingAttachments, removeAttachment]);

  const offer = useCallback((door: (turn: QueuedTurn) => Promise<boolean>, text: string, to: DirectedRecipient | null, attachments?: ChatInputAttachment[]) => {
    const turn: QueuedTurn = { text, recipient: to, attachments: attachments ?? takeAttachments() };
    // A send that was not kept (the session expired, another chat is showing) goes back to the box that is
    // showing - the one rule on every host (`restoreTurn`): never dropped, never sent into another chat.
    void door(turn).then((kept) => { if (!kept) giveBack(turn); });
  }, [takeAttachments, giveBack]);
  const sendOrQueue = useCallback((text: string, to: DirectedRecipient | null, attachments?: ChatInputAttachment[]) => offer(submitTurn, text, to, attachments), [offer, submitTurn]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    composer.setInput('');
    sendOrQueue(text, recipient);
  }, [input, recipient, sendOrQueue, composer]);

  // The explicit "Queue for after": hold the typed message until the run finishes (sent on its falling edge); with no run
  // going it is simply sent. Through THE door (`turns.queueAfter`), never the raw queue: from a draft it is held for the
  // creation of the chat it is typed in, like every other turn.
  const queueAfter = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    composer.setInput('');
    offer(queueTurnAfter, text, recipient);
  }, [queueTurnAfter, input, recipient, offer, composer]);

  // Answering an ask_user card posts the chosen option(s) as the user's next turn.
  const answerQuestion = useCallback((answer: string) => {
    sendOrQueue(answer, recipient);
  }, [recipient, sendOrQueue]);

  // "Send again" on any transcript message — queues behind a running turn like a typed one.
  const replayMessage = useCallback((message: BrainMessage) => {
    sendOrQueue(message.content, recipient);
  }, [recipient, sendOrQueue]);

  // `stop` clears the held turns AND stops the chat's run — the composer's Stop.
  // Send's verb: whether a message typed now would steer the run or be held (the door's own predicate).
  const sendSteers = turns.steers({ directed: recipient != null, attachments: composerFiles });
  return { queued: turns.queued, stop: turns.stop, submit, queueAfter, answerQuestion, replayMessage, sendSteers };
}
