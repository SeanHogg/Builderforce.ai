/**
 * The chat's ticket rail, bound to the editor — the shared `ChatTicketsPanel`'s adapter
 * (the gateway's chat↔ticket endpoints over the webview's bearer fetch), its localized
 * copy, the refresh signal the Brain's MCP writes bump, the "Changes (N)" pill, and
 * linking the work item a chat was opened for. Lifted out of the chat surface: the
 * surface only places the rail; everything it is fed with is decided here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import { chatTicketsLabelsFromBundle } from '@seanhogg/builderforce-brain-ui';
import type { AuthedFetch } from '../authedFetch';
import { createChatTicketsAdapter } from '../chatTicketsAdapter';
import { useChatChangedFiles } from '../useChatChangedFiles';
import { usePendingChangesExtension } from '../usePendingChangesExtension';
import { getToken, refreshToken, type InitData } from '../vscodeBridge';
import { spendLabelsFrom } from './composerLabels';

export function useTicketRail({ init, apiReq, chatId, chats, reloadChats, reloadMessages }: {
  init: InitData;
  apiReq: AuthedFetch;
  chatId: number | null;
  chats: BrainChat[];
  reloadChats: () => void;
  reloadMessages: () => void;
}) {
  // Same gateway endpoints as the web app's panel, over the webview's bearer fetch.
  const ticketAdapter = useMemo(
    () => createChatTicketsAdapter(init.baseUrl, getToken, () => void refreshToken()),
    [init.baseUrl],
  );
  // The rail's copy — the host's `ct.*` l10n keys (`src/chatTicketsLabels.ts`).
  const ticketLabels = useMemo(() => chatTicketsLabelsFromBundle(init.labels), [init.labels]);
  const spendLabels = useMemo(() => spendLabelsFrom(init.labels), [init.labels]);

  // Stable references so a keystroke / streaming token doesn't hand the memoized
  // <ChatTicketsPanel> fresh props and force its whole subtree to re-render.
  const ticketChatList = useMemo(() => chats.map((c) => ({
    id: c.id,
    title: c.title,
    ticketCount: c.ticketCount,
    ticketProgressPct: c.ticketProgressPct,
  })), [chats]);
  const onTicketsChanged = useCallback(() => { reloadChats(); reloadMessages(); }, [reloadChats, reloadMessages]);

  // Bumped when the Brain mutates work items via MCP tools, so the rail refreshes live
  // (rings/links) rather than only on its own button actions.
  const [ticketRefresh, setTicketRefresh] = useState(0);
  const bumpTicketRefresh = useCallback(() => setTicketRefresh((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener('bf:mcp-write', bumpTicketRefresh);
    return () => window.removeEventListener('bf:mcp-write', bumpTicketRefresh);
  }, [bumpTicketRefresh]);

  // "The agent changed code and nothing said so" — the chat's own signal, as a pill.
  const chatFiles = useChatChangedFiles(apiReq, chatId, ticketRefresh);
  const pendingChangesExtension = usePendingChangesExtension(init.labels, chatFiles);

  // Auto-link the work item that opened this chat (a task/epic/gap from the tree or
  // board, a roadmap/spec row from a project page) so the chat is tied to it and the
  // rail shows it. Bumps the refresh signal so the just-mounted rail re-fetches.
  const linkOpenedTicket = useCallback(
    async (linkChatId: number, ticket: { kind: string; ref: string }) => {
      try {
        await ticketAdapter.linkTicket(linkChatId, { kind: ticket.kind as never, ref: ticket.ref, linkType: 'linked' });
        bumpTicketRefresh();
      } catch { /* linking is best-effort — a failed link never blocks the chat */ }
    },
    [ticketAdapter, bumpTicketRefresh],
  );

  return {
    ticketAdapter, ticketLabels, spendLabels, ticketChatList, onTicketsChanged,
    ticketRefresh, bumpTicketRefresh, pendingChangesExtension, linkOpenedTicket,
  };
}
