import { useCallback, useMemo, useState } from 'react';
import { useChatRowActions } from '@seanhogg/builderforce-brain-ui';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import type { VsCodeChats } from './useVsCodeChats';

/** Case-insensitive title match; a blank query matches everything. */
function chatMatchesQuery(chat: BrainChat, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (chat.title ?? '').toLowerCase().includes(needle);
}

/**
 * The collection the history list renders: live vs archived, each narrowed by the
 * search box. Pure so the live/archived + query interplay is testable without React.
 */
export function filterChatHistory(
  chatOptions: BrainChat[],
  archivedChats: BrainChat[],
  showArchived: boolean,
  query: string,
): BrainChat[] {
  const base = showArchived ? archivedChats : chatOptions;
  return query.trim() ? base.filter((c) => chatMatchesQuery(c, query)) : base;
}

/**
 * The header's History lever and THE shared history-row state, held at SURFACE level:
 * the list unmounts whenever History closes, and a row's open actions or in-flight
 * rename must still be there when it opens again.
 *
 * The search box and the archived toggle live here for the same reason: the LIST is
 * deliberately stateless, so its filter/toggle STATE survives the list's unmount.
 *
 * Opening a chat — from a row, the New chat button or a host intent — closes History,
 * so the conversation it switched to is what the body shows.
 */
export function useChatHistoryView(chats: Pick<VsCodeChats, 'setChatId' | 'rename' | 'summarize' | 'archive' | 'unarchive' | 'remove' | 'confirmDelete' | 'chatOptions' | 'archivedChats'>) {
  const { setChatId, rename, summarize, archive, unarchive, remove, confirmDelete, chatOptions, archivedChats } = chats;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const toggleHistory = useCallback(() => setHistoryOpen((o) => !o), []);
  const toggleArchived = useCallback(() => setShowArchived((a) => !a), []);
  const openChat = useCallback((id: number | null) => { setChatId(id); setHistoryOpen(false); }, [setChatId]);

  // The collection the list renders: live vs archived, each filtered by the search box.
  const filteredChats = useMemo(
    () => filterChatHistory(chatOptions, archivedChats, showArchived, query),
    [showArchived, archivedChats, chatOptions, query],
  );

  // The SAME truth the rows render from: a chat is archived iff it lives in
  // `archivedChats`. The hook is COLLECTION-AGNOSTIC — it always offers both `archive`
  // and `unarchive`, and the row itself decides which to show from `isArchived(id)`
  // (Archive on a live row, Unarchive on an archived one). Never gate these by
  // `showArchived`: that would change the row-action identity on a toggle and remount
  // every row.
  const isArchived = useCallback(
    (id: number) => Boolean(archivedChats.find((c) => c.id === id)?.isArchived),
    [archivedChats],
  );
  const rows = useChatRowActions({
    onOpen: openChat, rename, summarize, archive, unarchive, remove, confirmDelete, isArchived,
  });
  return {
    historyOpen, toggleHistory, openChat, rows,
    query, setQuery, showArchived, toggleArchived, filteredChats,
    total: (showArchived ? archivedChats : chatOptions).length,
  };
}
