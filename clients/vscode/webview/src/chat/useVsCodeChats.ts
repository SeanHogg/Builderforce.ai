/**
 * The editor's conversation list — the SHARED `useBrainChats` (the web Brain panel's
 * lifecycle: list, create, rename, mode, memory, auto-title, pulling a chat that is not
 * in the list), plus only what is the editor's own:
 *
 * - the list is scoped to the sidebar's active project, and the host's Sessions tree is
 *   told when it actually moved (`chats.changed`);
 * - the composer's armed Chat|Work mode and Memory switch seed the chat the first send
 *   creates (`ensureChatId`), so choosing Chat and then typing never mints a Work chat;
 * - the host tab is bound to the open conversation (`session.meta`);
 * - a live run / a question waiting marks its chat in the history list (`runStatus`).
 *
 * Replaces the panel's own copy of that lifecycle (list state, auto-title, orphan
 * fetch, create, rename), which had drifted from the web's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CHAT_TITLE, useArmedNewChat, useBrainChats, useChatCreation, type BrainChat, type ChatMode } from '@seanhogg/builderforce-brain-embedded';
import { onHostMessage, onRefresh, post, request, type InitData } from '../vscodeBridge';
import { useGlobalRunState } from './useGlobalRunState';

export interface VsCodeChats {
  chatId: number | null;
  /** Open a conversation (null = a new, not-yet-created chat). Pulls in one the list lacks. */
  setChatId: (id: number | null) => void;
  /** The project-scoped list. */
  chats: BrainChat[];
  /** The history list's rows — the list, with the open chat first when it lives elsewhere. */
  chatOptions: BrainChat[];
  activeChat: BrainChat | null;
  reloadChats: () => void;
  /** Name a still-untitled chat from its first user turn (the conversation's `onFirstUserTurn`). */
  onFirstUserTurn: (id: number, firstUserText: string) => Promise<void>;
  /** The open chat, or the one the first send creates (shared single-flight `useChatCreation`); throws when it cannot. */
  ensureChatId: () => Promise<number>;
  /** Whether a chat's run is waiting on an answer, running, or idle (null) — drawn as a marker. */
  runStatus: (id: number) => ChatRunStatus;
  /** How a chat is named in the list (the untitled placeholder in this UI's language). */
  titleOf: (chat: BrainChat) => string;
  chatMode: ChatMode;
  selectMode: (mode: ChatMode) => void;
  setMemoryEnabled: (id: number, on: boolean) => Promise<void>;
  /** Arm the Memory switch before the chat exists. */
  armMemory: (on: boolean) => void;
  rename: (id: number, title: string) => Promise<void>;
  /** Rename a chat to a model-written summary of it (the shared `useBrainChats.summarize`);
   *  a failure — or a signed-out chat, which has no server to summarize it — lands in `error`. */
  summarize: (id: number) => Promise<void>;
  /** Ask the host's modal whether to delete (it refuses while the chat's run is live). */
  confirmDelete: (chat: { id: number; title: string }) => Promise<boolean>;
  /** Archive a chat through the panel's own store — the gateway signed in, this
   *  webview signed out — so the archived row leaves the list and an open archived
   *  chat is closed. */
  archive: (chat: { id: number; title: string }) => Promise<void>;
  /** Delete a chat through the panel's own store — the gateway signed in, this webview
   *  signed out — so the open chat is left only when it IS the deleted one. */
  remove: (chat: { id: number; title: string }) => Promise<void>;
  /** The list is still on its first read. */
  loading: boolean;
  /** The last failed list action (summarize, rename, delete…), until dismissed. */
  error: string;
  clearError: () => void;
}

export type ChatRunStatus = 'awaiting' | 'running' | null;

export function useVsCodeChats(init: InitData, newChatLabel: string): VsCodeChats {
  const [chatId, setActiveId] = useState<number | null>(null);
  const brainChats = useBrainChats({
    pinnedProjectId: init.project?.id ?? null,
    activeChatId: chatId,
    onActiveChatChange: setActiveId,
    placeholderTitles: [newChatLabel],
  });
  const { chats, select, setMemoryEnabled, rename, autoTitle, reload, summarize, setError } = brainChats;
  // The armed Chat|Work mode and Memory switch, and the one creation path carrying them.
  const { chatMode, selectMode: selectArmedMode, armMemory, createArmed } = useArmedNewChat(brainChats);

  // Tell the host's Sessions tree only when the list actually moved — every ticket
  // write in a run re-reads it, and most re-reads come back identical.
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    const sig = JSON.stringify(chats);
    if (lastSig.current === null) { lastSig.current = sig; return; }
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    post('chats.changed');
  }, [chats]);

  // The host re-reads after work done outside this view.
  useEffect(() => onRefresh(() => { void reload(); }), [reload]);
  // A chat deleted from the Sessions tree: leave it only if it is the one open here.
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  useEffect(() => onHostMessage<{ chatId?: number }>('chat.deleted', (m) => {
    if (m.chatId != null && m.chatId === chatIdRef.current) void select(null);
    void reload();
  }), [select, reload]);
  const confirmDelete = useCallback(
    (chat: { id: number; title: string }) =>
      request<boolean>('chat.confirmDelete', { chatId: chat.id, title: chat.title }).then((ok) => ok === true, () => false),
    [],
  );
  const { remove: removeChat, archive: archiveChat } = brainChats;
  const remove = useCallback((chat: { id: number; title: string }) => removeChat(chat.id), [removeChat]);
  const archive = useCallback((chat: { id: number; title: string }) => archiveChat(chat.id), [archiveChat]);
  const clearError = useCallback(() => setError(''), [setError]);

  const setChatId = useCallback((id: number | null) => { void select(id); }, [select]);
  const reloadChats = useCallback(() => { void reload(); }, [reload]);

  const activeChat = brainChats.activeChat;
  const chatOptions = useMemo(
    () => (activeChat && !chats.some((c) => c.id === activeChat.id) ? [activeChat, ...chats] : chats),
    [activeChat, chats],
  );

  const runState = useGlobalRunState();
  const runningSet = useMemo(() => new Set(runState.running), [runState]);
  const awaitingSet = useMemo(() => new Set(runState.awaiting), [runState]);
  const runStatus = useCallback(
    (id: number): ChatRunStatus => (awaitingSet.has(id) ? 'awaiting' : runningSet.has(id) ? 'running' : null),
    [awaitingSet, runningSet],
  );
  const titleOf = useCallback(
    (chat: BrainChat) => (!chat.title || chat.title === DEFAULT_CHAT_TITLE ? newChatLabel : chat.title),
    [newChatLabel],
  );

  // The first send creates the chat — ONE creation even if a second send lands while it
  // is in flight — scoped to the sidebar's active project (the hook's pin), in the armed
  // mode; its first user turn names it.
  const { ensureChatId: ensureCreated, onFirstUserTurn } = useChatCreation({
    chatId,
    create: async () => (await createArmed())?.id ?? null,
    autoTitle,
  });
  const ensureChatId = useCallback(async () => {
    const id = await ensureCreated();
    // The send cannot proceed without a conversation — surface why, as the old path did.
    if (id == null) throw new Error(brainChats.error || 'Could not create the chat');
    return id;
  }, [ensureCreated, brainChats.error]);

  // Bind the host tab to the open conversation (title undefined while it loads).
  const sessionTitle = activeChat ? titleOf(activeChat) : (chatId == null ? newChatLabel : undefined);
  useEffect(() => {
    post('session.meta', { chatId: chatId ?? undefined, title: sessionTitle });
  }, [chatId, sessionTitle]);

  const selectMode = useCallback((mode: ChatMode) => { void selectArmedMode(mode); }, [selectArmedMode]);

  return {
    chatId, setChatId, chats, chatOptions, activeChat, reloadChats, onFirstUserTurn, ensureChatId,
    runStatus, titleOf, chatMode, selectMode, setMemoryEnabled, armMemory, rename, summarize, confirmDelete, archive, remove,
    loading: brainChats.loading, error: brainChats.error, clearError,
  };
}
