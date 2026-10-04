import { useEffect, useRef, useState } from 'react';
import type { useBrainChats, useBrainConversation } from '@/lib/brain';
import { brain, type TicketKind } from '@/lib/builderforceApi';
import { dispatchBrainDataChanged } from '@/lib/brain/brainDataEvent';
import { nextSeedPromptStep } from '@/lib/brain/seedPrompt';

/**
 * The panel's one-shot entry seeds: a deep-linked chat (`?chat=`), a work item to
 * auto-link (`?ticket=`) and a prompt to auto-send (`?prompt=` / a replayed
 * landing-page prompt). Each fires at most once per mount.
 */
export function useBrainPanelSeeds({
  chats,
  conv,
  isPage,
  initialChatId,
  initialPrompt,
  initialTicket,
  pinnedProjectId,
  viewingProjectId,
  showChatTab,
}: {
  chats: ReturnType<typeof useBrainChats>;
  conv: ReturnType<typeof useBrainConversation>;
  isPage: boolean;
  initialChatId: number | null | undefined;
  initialPrompt: string | undefined;
  initialTicket: { kind: string; ref: string } | undefined;
  pinnedProjectId: number | null;
  viewingProjectId: number | null;
  /** Docked: bring the conversation tab forward (the seed lands there). */
  showChatTab: () => void;
}) {
  // Apply ?chat= deep link once chats are available.
  useEffect(() => {
    if (initialChatId == null || chats.loading) return;
    if (chats.activeChatId === initialChatId) return;
    chats.select(initialChatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChatId, chats.loading]);

  // Auto-link a one-shot work item on open (`?ticket=<kind>:<ref>`), so clicking an
  // item opens a chat already tied to it — the web parity for the VS Code "open task"
  // flow, reusing the SAME `brain.linkChatTicket` the picker uses. Ensures a chat
  // exists (deep-linked → active → a fresh project-scoped chat), links it, then lets
  // the ChatTicketsPanel refresh. `ticketReady` gates the prompt send so a combined
  // `?prompt=&ticket=` opens ONE chat (the linked one), not two.
  const ticketHandledRef = useRef(false);
  const [ticketReady, setTicketReady] = useState(() => !initialTicket);
  useEffect(() => {
    if (!initialTicket || ticketHandledRef.current || chats.loading) return;
    ticketHandledRef.current = true;
    void (async () => {
      try {
        let chatId = initialChatId ?? chats.activeChatId;
        if (chatId == null) {
          const created = await chats.create({ projectId: pinnedProjectId ?? viewingProjectId ?? null });
          chatId = created?.id ?? null;
        }
        if (chatId == null) return;
        await brain.linkChatTicket(chatId, { kind: initialTicket.kind as TicketKind, ref: initialTicket.ref, linkType: 'linked' });
        dispatchBrainDataChanged({ domain: 'brain', method: 'link' });
      } catch { /* best-effort auto-link — a failure never blocks the chat */ }
      finally { setTicketReady(true); }
    })();
  }, [initialTicket, initialChatId, chats, pinnedProjectId, viewingProjectId]);

  // Auto-send a one-shot SEED prompt (a home/landing-page prompt replayed after
  // auth, an IDE `?prompt=`). A seed starts a NEW conversation: the drawer
  // restores the chat you were last in, so sending straight away appended a
  // returning visitor's fresh idea to an old thread. `nextSeedPromptStep` decides
  // — clear the restored selection first, then send, at which point `conv.send`
  // creates the chat via `ensureChatId`. Refs (not state) so re-renders can never
  // re-send; `ticketReady` holds it until any auto-link has claimed its chat.
  const initialPromptSentRef = useRef(false);
  const initialPromptClearedRef = useRef(false);
  useEffect(() => {
    const text = initialPrompt?.trim() ?? '';
    const step = nextSeedPromptStep({
      prompt: text,
      ready: ticketReady && !chats.loading,
      alreadySent: initialPromptSentRef.current,
      targetChatId: initialChatId,
      targetTicket: initialTicket,
      activeChatId: chats.activeChatId,
      selectionCleared: initialPromptClearedRef.current,
    });
    if (step === 'clear-selection') {
      initialPromptClearedRef.current = true;
      void chats.select(null);
      return;
    }
    if (step !== 'send') return;
    initialPromptSentRef.current = true;
    if (!isPage) showChatTab();
    void conv.send(text);
  }, [initialPrompt, conv, ticketReady, initialChatId, initialTicket, isPage, chats, showChatTab]);
}
