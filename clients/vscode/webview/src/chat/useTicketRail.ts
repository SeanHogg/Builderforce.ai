/**
 * The chat's ticket rail, bound to the editor — the shared `ChatTicketsPanel`'s adapter, its
 * localized copy, the refresh signal the Brain's MCP writes bump, the "Changes (N)" pill, and
 * linking the work item a chat was opened for. Lifted out of the chat surface: the surface only
 * places the rail; everything it is fed with is decided here.
 *
 * The rail's tickets, runs and links are the HOST'S local copy (`local.chatRail`); only merge,
 * invite, run and the rest use the gateway endpoints, over the webview's bearer fetch. The rail
 * names a chat by `railChatId`: its bound SERVER id, else its local client id (a chat only on this
 * machine still has a rail, without the platform-only sections).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { serverChatIdOf, type BrainChat, type BrainPersistenceAdapter } from '@seanhogg/builderforce-brain-embedded';
import { chatTicketsLabelsFromBundle, localRailLabelsFromBundle, railTicketLabel, type TicketKind } from '@seanhogg/builderforce-brain-ui';
import type { AuthedFetch } from '../authedFetch';
import { createChatTicketsPlatform } from '../chatTicketsAdapter';
import { useChatChangedFiles } from '../useChatChangedFiles';
import { usePendingChangesExtension } from '../usePendingChangesExtension';
import { getToken, onHostMessage, refreshToken, type InitData } from '../vscodeBridge';
import { request } from '../bridgeTransport';
import { useCapability, webviewCapability } from '../useCapability';
import type { ChatRailFrame, ChatRailRequest, ChatRef } from '../../../src/chatRail/railProtocol';
import { createLocalRailAdapter, createRailStore, isFrameFor, ticketVm } from './localRailAdapter';
import { useLocalRailPieces, useRailSnapshot } from './localRailPieces';
import { spendLabelsFrom } from './composerLabels';

/** A linked ticket as the composer's `#` typeahead lists it. */
export type TypeaheadTicket = { id: number; title: string; status?: string; key?: string };

export function useTicketRail({ init, apiReq, serverChatId, chatClientId, chats, persistence, reloadChats, reloadMessages }: {
  init: InitData;
  apiReq: AuthedFetch;
  /** The chat's bound SERVER id (PRD 36), or null when it lives only on this machine. */
  serverChatId: number | null;
  /** The chat's local client id, when this device holds it. */
  chatClientId: string | null;
  chats: BrainChat[];
  persistence: BrainPersistenceAdapter;
  reloadChats: () => void;
  reloadMessages: () => void;
}) {
  const railChatId: ChatRef | null = serverChatId ?? chatClientId;
  const railStore = useMemo(() => createRailStore(), []);
  const localRailLabels = useMemo(() => localRailLabelsFromBundle(init.labels), [init.labels]);
  // The rail's copy — the host's `ct.*` l10n keys (`src/chatTicketsLabels.ts`).
  const ticketLabels = useMemo(() => chatTicketsLabelsFromBundle(init.labels), [init.labels]);
  const spendLabels = useMemo(() => spendLabelsFrom(init.labels), [init.labels]);
  const untitled = useCallback(
    (kind: TicketKind, ref: string) => railTicketLabel('', ticketLabels.kind[kind] ?? kind, ref, localRailLabels),
    [ticketLabels, localRailLabels],
  );
  const ticketAdapter = useMemo(() => {
    // A 401 re-mints (one shared exchange per burst) and retries the read once.
    const platform = createChatTicketsPlatform(init.baseUrl, getToken, refreshToken);
    return createLocalRailAdapter(
      platform.adapter,
      {
        call: <T,>(body: ChatRailRequest) => request<T>('local.chatRail', body as unknown as Record<string, unknown>),
        connected: () => webviewCapability('connected'),
        questionsFor: platform.questionsFor,
        untitled,
      },
      railStore,
    );
  }, [init.baseUrl, railStore, untitled]);
  const railSnapshot = useRailSnapshot(railStore, railChatId);
  const localRail = useLocalRailPieces(railSnapshot, localRailLabels, init.locale);
  // What a host push shows: the snapshot's tickets, handed to the panel without a read.
  const liveTickets = useMemo(() => railSnapshot?.tickets.map((tk) => ticketVm(tk, untitled)), [railSnapshot, untitled]);

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

  // The host pushes the chat's rail whenever a commit touches it (a link, a refresh). The push only
  // lands in the store: the panel repaints from `liveTickets`, with no read and no platform call.
  // A frame for another chat (a late one from before a switch) is dropped.
  const railChatRef = useRef(railChatId);
  useEffect(() => { railChatRef.current = railChatId; }, [railChatId]);
  useEffect(() => onHostMessage<ChatRailFrame>('local.chatRail', (frame) => {
    if (isFrameFor(frame, railChatRef.current)) railStore.set(frame.rail);
  }), [railStore]);

  // The composer's #-ticket typeahead: the chat's linked tickets, from the local rail copy.
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

  // "The agent changed code and nothing said so" — the chat's own signal, as a pill. LOCAL-FIRST:
  // the chat's changed files come from the host's local change-set records via the rail; the server
  // is only the backstop for a chat this device never recorded.
  const chatFiles = useChatChangedFiles(apiReq, ticketAdapter, railChatId, serverChatId == null, ticketRefresh);
  const pendingChangesExtension = usePendingChangesExtension(init.labels, chatFiles);

  // Link a work item to a chat — the work item that opened it (a task/epic/gap from the tree or
  // board, a roadmap/spec row from a project page) or one `#`-tagged in the composer. The link is a
  // LOCAL record on the chat (its server id when bound, else its client id), never a bind first:
  // it syncs to the platform once the chat does.
  const linkTicket = useCallback(
    async (localChatId: number, ticket: { kind: string; ref: string }) => {
      try {
        const chat = await persistence.getChat(localChatId);
        const linkChatId = serverChatIdOf(chat) ?? chat.clientId;
        if (linkChatId == null) return;
        await ticketAdapter.linkTicket(linkChatId, { kind: ticket.kind as never, ref: ticket.ref, linkType: 'linked' });
        reloadChats();
      } catch { /* linking is best-effort — a failed link never blocks the chat */ }
    },
    [persistence, ticketAdapter, reloadChats],
  );

  return {
    ticketAdapter, ticketLabels, spendLabels, ticketChatList, onTicketsChanged,
    ticketRefresh, pendingChangesExtension, linkTicket, typeaheadTickets, localRail, railChatId, liveTickets,
  };
}
