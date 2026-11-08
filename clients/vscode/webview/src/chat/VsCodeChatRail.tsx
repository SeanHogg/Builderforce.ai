/**
 * The editor chat's rail - the strip between the header and the thread. Lifted out of the chat surface so it is its own
 * memoized boundary: it is handed only values that move when the rail's content moves, so a streamed token (which
 * re-renders the surface) and a keystroke (which no longer does) leave it alone.
 *
 *  - a chat bound to the platform shows the shared `ChatTicketsPanel` (linked tickets, agents, people, spend, and the
 *    chat's original request);
 *  - a chat only on this machine (PRD 36) has no platform rail, but still has a first prompt and a cost: both show,
 *    through the same shared parts (`OriginalRequest`, `SpendPill`) the platform rail draws them with.
 */

import { memo, useCallback, useMemo } from 'react';
import type { BrainChat, BrainPersistenceAdapter } from '@seanhogg/builderforce-brain-embedded';
import { ChatTicketsPanel, OriginalRequest, SpendPill, type ChatTicketsExtension } from '@seanhogg/builderforce-brain-ui';
import { post, type InitData } from '../vscodeBridge';
import type { useChatAudience } from './useChatAudience';
import type { useTicketRail } from './useTicketRail';

/** Layout only (no colour): the local chat's rail is its original request, then its spend pill right-aligned. */
const LOCAL_RAIL_STYLE = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, padding: '4px 8px' } as const;
const LOCAL_SPEND_STYLE = { display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap' } as const;

type TicketRail = ReturnType<typeof useTicketRail>;
type Audience = ReturnType<typeof useChatAudience>;

export interface VsCodeChatRailProps {
  init: InitData;
  persistence: BrainPersistenceAdapter;
  /** The chat's local view key. */
  chatId: number;
  /** The chat's bound SERVER id (PRD 36), or null when it lives only on this machine. */
  serverChatId: number | null;
  activeChat: BrainChat | null;
  ticketAdapter: TicketRail['ticketAdapter'];
  ticketLabels: TicketRail['ticketLabels'];
  spendLabels: TicketRail['spendLabels'];
  ticketChatList: TicketRail['ticketChatList'];
  onTicketsChanged: TicketRail['onTicketsChanged'];
  /** The local-first header (sync summary, freshness) and per-ticket sync badge, from the host's local copy. */
  localRail: TicketRail['localRail'];
  pendingChangesExtension: ChatTicketsExtension | null | undefined;
  railRefresh: Audience['railRefresh'];
  subagentRoster: Audience['subagentRoster'];
  chatVisibility: 'shared' | 'locked';
  chatIsOwner: boolean;
  setChatVisibility: (v: 'shared' | 'locked') => void;
}

/** Whether the rail has anything to draw: a platform chat always has its panel; a local one only a first prompt or a cost. */
export function railHasContent(serverChatId: number | null, activeChat: BrainChat | null): boolean {
  return serverChatId != null || !!activeChat?.spend || !!activeChat?.originalRequest?.trim();
}

function VsCodeChatRailInner(props: VsCodeChatRailProps) {
  const {
    init, persistence, chatId, serverChatId, activeChat, ticketAdapter, ticketLabels, spendLabels, ticketChatList, onTicketsChanged, localRail,
    pendingChangesExtension, railRefresh, subagentRoster, chatVisibility, chatIsOwner, setChatVisibility,
  } = props;
  const projectId = init.project?.id ?? null;
  const setVisibility = useCallback(async (v: 'shared' | 'locked') => {
    await persistence.updateChat(chatId, { visibility: v });
    setChatVisibility(v);
  }, [chatId, persistence, setChatVisibility]);
  const openTicket = useCallback(
    (tk: { kind: string; ref: string }) => post('open.artifact', { kind: tk.kind, ref: tk.ref, projectId: projectId ?? undefined }),
    [projectId],
  );
  // "Changes (N)" beside Link ticket / Agents / People; a clean tree adds nothing.
  const extensions = useMemo(() => (pendingChangesExtension ? [pendingChangesExtension] : undefined), [pendingChangesExtension]);

  if (serverChatId == null) {
    // A chat only on this machine has no platform rail - its original request and its spend, folded on the device from its
    // run usage ledger, still show.
    if (!activeChat || !railHasContent(null, activeChat)) return null;
    return (
      <div style={LOCAL_RAIL_STYLE}>
        <OriginalRequest text={activeChat.originalRequest} labels={ticketLabels} />
        {activeChat.spend && (
          <div style={LOCAL_SPEND_STYLE}>
            <SpendPill summary={activeChat.spend} labels={spendLabels} locale={init.locale} />
          </div>
        )}
      </div>
    );
  }
  return (
    <ChatTicketsPanel
      chatId={serverChatId}
      projectId={projectId}
      chatList={ticketChatList}
      adapter={ticketAdapter}
      labels={ticketLabels}
      onChanged={onTicketsChanged}
      refreshSignal={railRefresh}
      visibility={chatVisibility}
      onSetVisibility={chatIsOwner ? setVisibility : undefined}
      onOpenTicket={openTicket}
      extensions={extensions}
      subagents={subagentRoster}
      // What this conversation cost and what memory saved - rides the chat row.
      spend={activeChat?.spend}
      spendLabels={spendLabels}
      locale={init.locale}
      // The chat's first prompt, kept verbatim (1245) - rides the chat row like spend.
      originalRequest={activeChat?.originalRequest}
      // The device's sync summary + freshness, and each ticket's sync status - from the local copy.
      railHeader={localRail.railHeader}
      ticketBadge={localRail.ticketBadge}
    />
  );
}

export const VsCodeChatRail = memo(VsCodeChatRailInner);
