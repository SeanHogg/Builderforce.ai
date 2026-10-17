/**
 * The rail's sort choice, remembered per viewer. The panel remounts on every chat
 * switch, so a plain `useState('open')` threw the choice away each time; it is a
 * viewer preference (not a chat's), so it lives in this browser's / webview's storage —
 * one key shared by every chat. Storage that is missing or refuses (private mode, a
 * sandboxed frame, quota) degrades to the in-memory default.
 */
import { useCallback, useState } from 'react';
import { parseChatTicketSort, type ChatTicketSort } from './sortChatTickets';

const SORT_KEY = 'bf.chatTickets.sort';

function readSort(): ChatTicketSort {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(SORT_KEY);
    return stored ? parseChatTicketSort(stored) : 'open';
  } catch {
    return 'open'; // storage unavailable — the default order
  }
}

function writeSort(sort: ChatTicketSort): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SORT_KEY, sort);
  } catch {
    // storage unavailable — the choice holds for this mount only
  }
}

export function useChatTicketSort(): [ChatTicketSort, (sort: ChatTicketSort) => void] {
  const [sort, setSort] = useState<ChatTicketSort>(readSort);
  const choose = useCallback((next: ChatTicketSort) => { setSort(next); writeSort(next); }, []);
  return [sort, choose];
}
