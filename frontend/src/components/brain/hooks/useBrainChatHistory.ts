import { useMemo, useState } from 'react';
import type { BrainChat } from '@/lib/builderforceApi';

/** The chat-history list's search and the unread count its tab advertises. */
export function useBrainChatHistory({ chatList, activeChatId, chatUnread }: {
  chatList: BrainChat[];
  activeChatId: number | null;
  /** Unread messages per chat id (the attention feed). */
  chatUnread: Record<number, number | undefined>;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredChats = useMemo(
    () => (searchQuery.trim()
      ? chatList.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      : chatList),
    [chatList, searchQuery],
  );

  // Unread messages sitting in chats OTHER than the open one — the reason to go
  // look at history at all, surfaced on the tab so it isn't a blind switch.
  const historyUnread = useMemo(
    () => chatList.reduce((n, c) => n + (c.id === activeChatId ? 0 : (chatUnread[c.id] ?? 0)), 0),
    [chatList, activeChatId, chatUnread],
  );

  return { searchQuery, setSearchQuery, filteredChats, historyUnread };
}
