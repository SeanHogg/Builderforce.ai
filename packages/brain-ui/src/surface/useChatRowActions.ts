import { useCallback, useRef, useState } from 'react';
import type { ChatHistoryRowProps } from './ChatHistory';

/** What a row action needs of a chat — the shared history row hands back this much. */
export interface ChatRowRef {
  id: number;
  title: string;
}

export interface UseChatRowActionsOptions {
  /** Open the chat (the host switches to it, and closes / leaves its history view). */
  onOpen: (id: number) => void;
  /** Reveal the opened row's actions — a host that keeps the list beside the thread
   *  (the web Brain page) instead of leaving it on open. */
  revealActionsOnOpen?: boolean;
  /** Persist a new title. Only called for a non-blank title that actually changed. */
  rename: (id: number, title: string) => Promise<unknown> | void;
  /** Rows offer Summarize only when the host supplies it. */
  summarize?: (id: number) => Promise<unknown> | void;
  /** Rows offer Delete only when the host supplies it. */
  remove?: (chat: ChatRowRef) => Promise<unknown> | void;
  /** Asked before `remove`; false cancels. Hosts word and render their own confirm. */
  confirmDelete?: (chat: ChatRowRef) => Promise<boolean>;
  /** The web's "Add to project" (null = take it out of its project). */
  assign?: (chatId: number, projectId: number | null) => Promise<unknown> | void;
}

/** The action props a `ChatHistoryRow` takes, bound to one chat. */
export type ChatRowActionProps = Pick<
  ChatHistoryRowProps,
  | 'onOpen' | 'actionsOpen' | 'onToggleActions' | 'renaming' | 'renameValue' | 'onStartRename' | 'onRenameChange'
  | 'onSubmitRename' | 'onCancelRename' | 'onSummarize' | 'summarizing' | 'onDelete' | 'deleting'
>;

/**
 * THE chat-history row state and its per-row actions (open, reveal actions, rename,
 * summarize, delete, assign) — every host's `ChatHistoryRow`s bind through it (web
 * Brain panel, the editor's chat surface, Rovr), so the rules live once:
 *
 * - one row's actions are revealed at a time, toggled from its "more" button;
 * - Rename is inline; a blank or unchanged title just cancels (no needless write), and
 *   Enter commits once — the input unmounts on Enter and its blur would commit again;
 * - Summarize / Delete / Assign each mark their row busy while in flight;
 * - Delete asks the host's `confirmDelete` first.
 *
 * Hold it ABOVE the list, at surface/panel level: a history list unmounts while the
 * conversation is shown (a docked tab, the editor's History lever), and a row's open
 * actions or in-flight rename must still be there when the user comes back.
 *
 * Handlers read the host's callbacks through a ref, so they keep their identity
 * across renders and the memoized rows do not re-render on every parent render.
 */
export function useChatRowActions(options: UseChatRowActionsOptions) {
  const opts = useRef(options);
  opts.current = options;

  /** Which chat row has its actions revealed. */
  const [actionsChatId, setActionsChatId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** The title the open rename started from (the unchanged check). */
  const renameFrom = useRef('');
  /** The rename already committed or cancelled — Enter unmounts the input and its blur fires again. */
  const settled = useRef<number | null>(null);

  const openChat = useCallback((id: number) => {
    opts.current.onOpen(id);
    if (opts.current.revealActionsOnOpen) setActionsChatId(id);
  }, []);

  const toggleActions = useCallback((id: number) => {
    setActionsChatId((cur) => (cur === id ? null : id));
  }, []);

  const startRename = useCallback((chat: ChatRowRef) => {
    settled.current = null;
    renameFrom.current = chat.title;
    setRenamingId(chat.id);
    setRenameValue(chat.title);
    setActionsChatId(null);
  }, []);

  const endRename = useCallback((id: number | null) => {
    settled.current = id;
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const renamingRef = useRef(renamingId);
  renamingRef.current = renamingId;
  const cancelRename = useCallback(() => endRename(renamingRef.current), [endRename]);

  /** The row submits its own id and draft — the row being renamed IS `renamingId`. */
  const submitRename = useCallback(async (id: number, value: string) => {
    if (settled.current === id) return;
    endRename(id);
    const title = value.trim();
    if (!title || title === renameFrom.current.trim()) return;
    await opts.current.rename(id, title);
  }, [endRename]);

  const onSummarize = useCallback(async (id: number) => {
    setSummarizingId(id);
    try { await opts.current.summarize?.(id); } finally { setSummarizingId((cur) => (cur === id ? null : cur)); }
  }, []);

  const onDelete = useCallback(async (chat: ChatRowRef) => {
    const { confirmDelete, remove } = opts.current;
    if (!remove) return;
    if (confirmDelete && !(await confirmDelete({ id: chat.id, title: chat.title }))) return;
    setDeletingId(chat.id);
    try {
      await remove({ id: chat.id, title: chat.title });
      setActionsChatId((cur) => (cur === chat.id ? null : cur));
    } finally {
      setDeletingId((cur) => (cur === chat.id ? null : cur));
    }
  }, []);

  const onAssign = useCallback(async (chatId: number, projectId: number | null) => {
    setBusyId(chatId);
    try { await opts.current.assign?.(chatId, projectId); } finally { setBusyId((cur) => (cur === chatId ? null : cur)); }
  }, []);

  const hasSummarize = Boolean(options.summarize);
  const hasRemove = Boolean(options.remove);
  /** Every action prop of one `ChatHistoryRow` — spread it onto the row. */
  const rowProps = (id: number): ChatRowActionProps => {
    const renaming = renamingId === id;
    return {
      onOpen: openChat,
      actionsOpen: actionsChatId === id,
      onToggleActions: toggleActions,
      renaming,
      renameValue: renaming ? renameValue : '',
      onStartRename: startRename,
      onRenameChange: setRenameValue,
      onSubmitRename: submitRename,
      onCancelRename: cancelRename,
      onSummarize: hasSummarize ? onSummarize : undefined,
      summarizing: summarizingId === id,
      onDelete: hasRemove ? onDelete : undefined,
      deleting: deletingId === id,
    };
  };

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
    rowProps,
  };
}

export type ChatRowActions = ReturnType<typeof useChatRowActions>;
