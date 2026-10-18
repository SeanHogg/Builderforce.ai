import { useCallback, useState } from 'react';
import { useChatRowActions } from '@seanhogg/builderforce-brain-ui';
import type { VsCodeChats } from './useVsCodeChats';

/**
 * The header's History lever and THE shared history-row state, held at SURFACE level:
 * the list unmounts whenever History closes, and a row's open actions or in-flight
 * rename must still be there when it opens again.
 *
 * Opening a chat — from a row, the New chat button or a host intent — closes History,
 * so the conversation it switched to is what the body shows.
 */
export function useChatHistoryView(chats: Pick<VsCodeChats, 'setChatId' | 'rename' | 'summarize' | 'archive' | 'remove' | 'confirmDelete' | 'chatOptions'>) {
  const { setChatId, rename, summarize, archive, remove, confirmDelete, chatOptions } = chats;
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = useCallback(() => setHistoryOpen((o) => !o), []);
  const openChat = useCallback((id: number | null) => { setChatId(id); setHistoryOpen(false); }, [setChatId]);
  // The SAME collection the list renders (`chats={chatOptions}`), so the Archive gate
  // tests the row's real chat: a chat archived elsewhere while open is in `chatOptions`
  // as the open chat, and offering "Archive" on it again would be a no-op at best.
  const isArchived = useCallback(
    (id: number) => Boolean(chatOptions.find((c) => c.id === id)?.isArchived),
    [chatOptions],
  );
  const rows = useChatRowActions({ onOpen: openChat, rename, summarize, archive, remove, confirmDelete, isArchived });
  return { historyOpen, toggleHistory, openChat, rows };
}
