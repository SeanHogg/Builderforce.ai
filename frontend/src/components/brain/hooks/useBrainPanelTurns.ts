import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useChatTurns, type DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import type { useBrainChats, useBrainConversation } from '@/lib/brain';
import { useDockedComposer } from '@/lib/brain/dockedBrain';
import { trackActivity } from '@/lib/activity/tracker';
import { useAssistantGate } from '@/lib/academic/useAssistantGate';

/**
 * One turn the panel sends: its text and who it is addressed to, fixed when it is
 * offered — so a turn held behind a run still reaches whoever it was typed to (the
 * editor's `QueuedTurn` carries the same pair). `null` runs the BRAIN; a participant is
 * talked to (no BRAIN run).
 */
export interface BrainPanelTurn {
  text: string;
  addressedTo: DirectedRecipient | null;
}

const turnText = (turn: BrainPanelTurn) => turn.text;

/**
 * The web Brain panel's binding of THE ONE turn door (`useChatTurns`, shared with every
 * composer host): a turn typed while a run is streaming is HELD and flushed one at a
 * time as each run completes, so the composer NEVER blocks typing; Stop clears what is
 * held. Also the panel's two ways in that are not typed — a neighbouring surface handing
 * text over (`useDockedComposer`) — and the exam gate every path into a send answers to.
 */
export function useBrainPanelTurns({ conv, chats, recipient, input, setInput, showChatTab, acceptsHandover }: {
  conv: ReturnType<typeof useBrainConversation>;
  chats: ReturnType<typeof useBrainChats>;
  /** Who the composer is pointed at right now (`useRecipientChoice`). */
  recipient: DirectedRecipient | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  showChatTab: () => void;
  /** This panel IS the page's chat (docked, no close) — it takes text a neighbour hands it. */
  acceptsHandover: boolean;
}) {
  const turns = useChatTurns<BrainPanelTurn>({
    running: conv.sending,
    runKey: chats.activeChatId,
    send: ({ text, addressedTo }) => conv.send(text, { addressedTo }),
    textOf: turnText,
    // A turn for a participant is a message to them — never the Brain's Stop.
    isDirected: (turn) => turn.addressedTo != null,
    // The conversation's Stop: it also drops a launch still getting ready.
    stop: conv.stop,
  });
  const { submit: submitTurn, queued } = turns;

  // The shared composer renders held turns as text; the addressee rides the turn itself.
  const { items, count, remove } = queued;
  const queuedText = useMemo(() => ({
    items: items.map((item) => ({ id: item.id, value: item.value.text })),
    count,
    remove,
  }), [items, count, remove]);

  // The exam gate — the composer already refuses, and so must every other path into a
  // send (a suggestion, a replayed prompt): a refusal, never a silent allow.
  const assistantGate = useAssistantGate();

  // Text a neighbouring surface hands the page's chat: to finish and send (Studio's Media
  // panel "use in app"), or to send now (the preview's "Fix it for me" — the click is the
  // person sending it). A handed-over turn always runs the BRAIN — it asks for work on the
  // thing on screen, whoever the composer happens to be pointed at — through the same
  // gate and door as a typed one.
  const dockedComposer = useMemo(() => ({
    seed: (text: string) => { setInput(text); showChatTab(); },
    send: (text: string) => {
      if (!assistantGate.assistantAllowed) return;
      showChatTab();
      void submitTurn({ text, addressedTo: null });
    },
  }), [setInput, showChatTab, assistantGate.assistantAllowed, submitTurn]);
  useDockedComposer(acceptsHandover, dockedComposer);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !assistantGate.assistantAllowed) return;
    setInput('');
    // Audited engagement signal: interacting with the AI agent is billable activity.
    trackActivity('agent_message', { weight: 2 });
    // Restore the text if the send fails before it's persisted (e.g. an expired
    // session) so the user's message is never silently lost.
    const ok = await submitTurn({ text, addressedTo: recipient });
    if (!ok) setInput((cur) => cur || text);
  }, [assistantGate.assistantAllowed, input, recipient, setInput, submitTurn]);

  return {
    /** The held turns as the composer renders them (text), removable. */
    queued: queuedText,
    /** The door itself — an answered question or a replay goes through it like a typed turn. */
    submitTurn,
    /** Stop the run AND drop the held turns — the composer's Stop. */
    stopTurn: turns.stop,
    handleSend,
  };
}
