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
export function useChatHistoryView(chats: Pick<VsCodeChats, 'setChatId' | 'rename' | 'summarize' | 'remove' | 'confirmDelete'>) {
  const { setChatId, rename, summarize, remove, confirmDelete } = chats;
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = useCallback(() => setHistoryOpen((o) => !o), []);
  const openChat = useCallback((id: number | null) => { setChatId(id); setHistoryOpen(false); }, [setChatId]);
  const rows = useChatRowActions({ onOpen: openChat, rename, summarize, remove, confirmDelete });
  return { historyOpen, toggleHistory, openChat, rows };
}
