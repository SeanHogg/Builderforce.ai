import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import type { useBrainChats } from '@/lib/brain';
import type { BrainChat } from '@/lib/builderforceApi';

/**
 * The chat-history row state and its per-row actions (open, reveal actions,
 * rename, summarize, delete, assign to a project).
 *
 * Held at panel level rather than inside the list: docked, the list is a tab that
 * unmounts while the conversation is shown, and a row's open actions / in-flight
 * rename must still be there when the user comes back.
 *
 * Every handler depends on the chat hook's individual (stable) methods rather than
 * on its per-render result object, so the memoized rows skip re-rendering while
 * the user types in the composer.
 */
export function useBrainChatRowActions({ chats, isPage, showChatTab }: {
  chats: ReturnType<typeof useBrainChats>;
  isPage: boolean;
  /** Docked: bring the conversation tab forward. */
  showChatTab: () => void;
}) {
  const tBrain = useTranslations('brain');
  const confirm = useConfirm();
  /** Which chat row has its rename/summarize/delete/assign actions revealed. */
  const [actionsChatId, setActionsChatId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const { select, rename, summarize, remove, assignToProject } = chats;

  /**
   * Open an existing chat from the history list. Docked, history is a tab beside
   * the conversation, so opening a chat has to switch back to it; the page keeps
   * the list permanently beside the thread and instead reveals that row's
   * actions (its long-standing behaviour).
   */
  const openChat = useCallback((id: number) => {
    void select(id);
    if (isPage) setActionsChatId(id);
    else showChatTab();
  }, [select, isPage, showChatTab]);

  const toggleActions = useCallback((id: number) => {
    setActionsChatId((cur) => (cur === id ? null : id));
  }, []);

  const startRename = useCallback((chat: BrainChat) => {
    setRenamingId(chat.id);
    setRenameValue(chat.title);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  /** The row submits its own id and draft — the row being renamed IS `renamingId`. */
  const submitRename = useCallback(async (id: number, value: string) => {
    if (value.trim()) await rename(id, value);
    setRenamingId(null);
    setRenameValue('');
  }, [rename]);

  const onSummarize = useCallback(async (id: number) => {
    setSummarizingId(id);
    try { await summarize(id); } finally { setSummarizingId(null); }
  }, [summarize]);

  const onDelete = useCallback(async (chat: BrainChat) => {
    const title = chat.title?.trim() || tBrain('thisChat');
    if (!(await confirm(tBrain('deleteChatConfirm', { title })))) return;
    setDeletingId(chat.id);
    try { await remove(chat.id); } finally { setDeletingId(null); }
  }, [remove, confirm, tBrain]);

  const onAssign = useCallback(async (chatId: number, projectId: number | null) => {
    setBusyId(chatId);
    try { await assignToProject(chatId, projectId); } finally { setBusyId(null); }
  }, [assignToProject]);

  return {
    actionsChatId,
    renamingId,
    renameValue,
    setRenameValue,
    summarizingId,
    deletingId,
    busyId,
    openChat,
    toggleActions,
    startRename,
    cancelRename,
    submitRename,
    onSummarize,
    onDelete,
    onAssign,
  };
}
