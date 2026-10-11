import { useCallback, useEffect, useRef } from 'react';
import { chatProgressIsStale, type ChatTicketHealthInput } from '@builderforce/agent-loop';
import type { ChatOptionVM } from './types';

/**
 * Keeps the host's chat list in step with the tickets the rail just read.
 *
 * The rail reads the chat's tickets on every change. The conversation picker and the
 * VS Code Sessions tree show a chat-list snapshot (`ticketCount`, `ticketProgressPct`),
 * which only the host refetches. A ticket moving under a run, an MCP write, a link or
 * an unlink all updated the rail and left that snapshot behind, so one chat read
 * 60% in the rail, 18% in the picker and 23% in the tree.
 *
 * The returned callback is handed each fresh ticket list. When the snapshot row for
 * this chat disagrees with it, the host is told once (`onStale`, the panel's
 * `onChanged`), and its refetch carries the same server figure to every surface.
 * It reports once per distinct (chat, count, percent) so a server that briefly still
 * reads the old value cannot start a refetch loop.
 */
export function useChatProgressSync(
  chatId: number,
  chatList: readonly ChatOptionVM[],
  onStale: (() => void) | undefined,
): (tickets: readonly ChatTicketHealthInput[]) => void {
  // Refs, so the callback is stable and the panel's `load` never re-runs because a
  // parent re-rendered the list.
  const rowRef = useRef<ChatOptionVM | undefined>(undefined);
  const onStaleRef = useRef(onStale);
  const reported = useRef<string | null>(null);
  useEffect(() => {
    rowRef.current = chatList.find((c) => c.id === chatId);
    onStaleRef.current = onStale;
  }, [chatList, chatId, onStale]);

  return useCallback((tickets: readonly ChatTicketHealthInput[]) => {
    const row = rowRef.current;
    if (!onStaleRef.current || !chatProgressIsStale(row, tickets)) return;
    const signature = `${chatId}:${tickets.length}:${tickets.map((t) => `${t.progressPct}/${t.status ?? ''}`).join(',')}`;
    if (reported.current === signature) return;
    reported.current = signature;
    onStaleRef.current();
  }, [chatId]);
}
