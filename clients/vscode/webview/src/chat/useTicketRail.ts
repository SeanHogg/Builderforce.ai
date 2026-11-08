/**
 * The chat's ticket rail, bound to the editor — the shared `ChatTicketsPanel`'s adapter
 * (the gateway's chat↔ticket endpoints over the webview's bearer fetch), its localized
 * copy, the refresh signal the Brain's MCP writes bump, the "Changes (N)" pill, and
 * linking the work item a chat was opened for. Lifted out of the chat surface: the
 * surface only places the rail; everything it is fed with is decided here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { serverChatIdOf, type BrainChat, type BrainPersistenceAdapter } from '@seanhogg/builderforce-brain-embedded';
import { chatTicketsLabelsFromBundle, localRailLabelsFromBundle } from '@seanhogg/builderforce-brain-ui';
import type { AuthedFetch } from '../authedFetch';
import { createChatTicketsAdapter } from '../chatTicketsAdapter';
import { useChatChangedFiles } from '../useChatChangedFiles';
import { usePendingChangesExtension } from '../usePendingChangesExtension';
import { getToken, onHostMessage, refreshToken, type InitData } from '../vscodeBridge';
import { request } from '../bridgeTransport';
import { useCapability, webviewCapability } from '../useCapability';
import type { ChatRailFrame, ChatRailRequest } from '../../../src/chatRail/railProtocol';
import { createLocalRailAdapter, createRailStore } from './localRailAdapter';
import { useLocalRailPieces, useRailSnapshot } from './localRailPieces';
import { spendLabelsFrom } from './composerLabels';

/** A linked ticket as the composer's `#` typeahead lists it. */
export type TypeaheadTicket = { id: number; title: string; status?: string; key?: string };

/**
 * Every call the rail makes is SERVER-addressed (`/api/brain/chats/{id}/…`), so it names
 * the chat's bound server id (PRD 36) — never the local view key, which named whichever
 * server chat shared its number. `serverChatId` null = the chat is only on this machine:
 * no rail call is made.
 */
export function useTicketRail({ init, apiReq, serverChatId, chats, persistence, reloadChats, reloadMessages }: {
  init: InitData;
  apiReq: AuthedFetch;
  serverChatId: number | null;
  chats: BrainChat[];
  persistence: BrainPersistenceAdapter;
  reloadChats: () => void;
  reloadMessages: () => void;
}) {
  // The rail's tickets and runs are the HOST's local copy (`local.chatRail`), and link/unlink write
  // local records through it; only merge, invite, run and the rest use the gateway endpoints the
  // web app's panel uses, over the webview's bearer fetch.
  const railStore = useMemo(() => createRailStore(), []);
  const ticketAdapter = useMemo(
    // A 401 re-mints (one shared exchange per burst) and retries the read once — a
    // fire-and-forget refresh left the rail empty until something else refreshed it.
    () => createLocalRailAdapter(
      createChatTicketsAdapter(init.baseUrl, getToken, refreshToken),
      {
        call: <T,>(body: ChatRailRequest) => request<T>('local.chatRail', body as unknown as Record<string, unknown>),
        connected: () => webviewCapability('connected'),
      },
      railStore,
    ),
    [init.baseUrl, railStore],
  );
  const localRailLabels = useMemo(() => localRailLabelsFromBundle(init.labels), [init.labels]);
  const railSnapshot = useRailSnapshot(railStore, serverChatId);
  const localRail = useLocalRailPieces(railSnapshot, localRailLabels, init.locale);
  // The rail's copy — the host's `ct.*` l10n keys (`src/chatTicketsLabels.ts`).
  const ticketLabels = useMemo(() => chatTicketsLabelsFromBundle(init.labels), [init.labels]);
  const spendLabels = useMemo(() => spendLabelsFrom(init.labels), [init.labels]);

  // Stable references so a keystroke / streaming token doesn't hand the memoized
  // <ChatTicketsPanel> fresh props and force its whole subtree to re-render.
  // By SERVER id — the rail merges and reads progress on the platform; an unbound chat
  // is not one of its options.
  const ticketChatList = useMemo(() => chats.flatMap((c) => {
    const id = serverChatIdOf(c);
    return id == null ? [] : [{ id, title: c.title, ticketCount: c.ticketCount, ticketProgressPct: c.ticketProgressPct }];
  }), [chats]);
  const onTicketsChanged = useCallback(() => { reloadChats(); reloadMessages(); }, [reloadChats, reloadMessages]);

  // Bumped when the Brain mutates work items via MCP tools, so the rail refreshes live
  // (rings/links) rather than only on its own button actions.
  const [ticketRefresh, setTicketRefresh] = useState(0);
  const bumpTicketRefresh = useCallback(() => setTicketRefresh((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener('bf:mcp-write', bumpTicketRefresh);
    return () => window.removeEventListener('bf:mcp-write', bumpTicketRefresh);
  }, [bumpTicketRefresh]);

  // The host pushes the chat's rail whenever a commit touches it (a link, a refresh, a sync receipt):
  // keep the snapshot and reload what the panel shows from the store.
  useEffect(() => onHostMessage<ChatRailFrame>('local.chatRail', (frame) => {
    railStore.push(frame.rail);
    bumpTicketRefresh();
  }), [railStore, bumpTicketRefresh]);

  // The composer's #-ticket typeahead: the chat's linked tickets. Read here, by the
  // SERVER id, beside every other rail read — the composer read them by the local view
  // key (`/chats/6/tickets` for a chat bound to 172, a 404 on every refresh).
  //
  // OFFLINE `#`: when the platform is denied there is no server chat to read links
  // from, so the typeahead lists the host's LOCAL tickets (G05 `localWorkRepository`
  // over the `local.tickets` bridge). An unbound chat offline reads local too.
  // Reactive: a late `platform.policy` frame must re-run this read on the right source.
  const offline = !useCapability('connected');
  const [typeaheadTickets, setTypeaheadTickets] = useState<TypeaheadTicket[]>([]);
  useEffect(() => {
    if (!offline && serverChatId != null) {
      let live = true;
      ticketAdapter.listTickets(serverChatId).then((tickets) => {
        if (live) setTypeaheadTickets(tickets.map((tk) => ({ id: parseInt(tk.ref) || tk.linkId, title: tk.label || tk.ref, status: tk.status, key: tk.ref })));
      }).catch(() => { if (live) setTypeaheadTickets([]); });
      return () => { live = false; };
    }
    let live = true;
    request<Array<{ id: number; title: string; status?: string }>>('local.tickets')
      .then((tickets) => { if (live) setTypeaheadTickets(tickets.map((t) => ({ id: t.id, title: t.title, status: t.status }))); })
      .catch(() => { if (live) setTypeaheadTickets([]); });
    return () => { live = false; };
  }, [offline, serverChatId, ticketAdapter, ticketRefresh]);

  // "The agent changed code and nothing said so" — the chat's own signal, as a pill.
  const chatFiles = useChatChangedFiles(apiReq, serverChatId, ticketRefresh);
  const pendingChangesExtension = usePendingChangesExtension(init.labels, chatFiles);

  // Link a work item to a LOCAL chat — the work item that opened it (a task/epic/gap from
  // the tree or board, a roadmap/spec row from a project page) or one `#`-tagged in the
  // composer. A local chat's id names no server chat, so it is bound first; a signed-out
  // editor has no platform chat to link to, and links nothing.
  const linkTicket = useCallback(
    async (localChatId: number, ticket: { kind: string; ref: string }) => {
      try {
        const linkChatId = await persistence.bindChat?.(localChatId);
        if (linkChatId == null) return;
        await ticketAdapter.linkTicket(linkChatId, { kind: ticket.kind as never, ref: ticket.ref, linkType: 'linked' });
        reloadChats();
        bumpTicketRefresh();
      } catch { /* linking is best-effort — a failed link never blocks the chat */ }
    },
    [persistence, ticketAdapter, reloadChats, bumpTicketRefresh],
  );

  return {
    ticketAdapter, ticketLabels, spendLabels, ticketChatList, onTicketsChanged,
    ticketRefresh, pendingChangesExtension, linkTicket, typeaheadTickets, localRail,
  };
}
