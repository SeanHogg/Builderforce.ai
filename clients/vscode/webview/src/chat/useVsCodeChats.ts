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
import { DEFAULT_CHAT_TITLE, useArmedNewChat, useBrainChats, useChatCreation, type BrainChat, type ChatMode, type DraftBinding, type DraftToken } from '@seanhogg/builderforce-brain-embedded';
import { selectPendingAskUser } from '@seanhogg/builderforce-brain-ui';
import { onHostMessage, onRefresh, post, request, type InitData } from '../vscodeBridge';
import { createHostPersistence } from '../hostPersistence';
import { daysIdleOf } from './chatIdle';
import { useGlobalRunState } from './useGlobalRunState';

export interface VsCodeChats {
  chatId: number | null;
  /** Open a conversation (null = a new, not-yet-created chat). Pulls in one the list lacks. */
  setChatId: (id: number | null) => void;
  /** The project-scoped list. */
  chats: BrainChat[];
  /** The archived chats `chats` hides — the archive surface reads through this. */
  archivedChats: BrainChat[];
  /** The history list's rows — the list, with the open chat first when it lives elsewhere. */
  chatOptions: BrainChat[];
  activeChat: BrainChat | null;
  reloadChats: () => void;
  /** Name a still-untitled chat from its first user turn (the conversation's `onFirstUserTurn`). */
  onFirstUserTurn: (id: number, firstUserText: string, composedText?: string) => Promise<void>;
  /** The open chat, or the one the first send creates (shared single-flight `useChatCreation`, under the send's own draft token); throws when it cannot. */
  ensureChatId: (draft?: DraftToken) => Promise<number>;
  /** The draft's binding to its creation - the turn door lands what is typed meanwhile in the chat it created (`useChatTurns({ drafts })`). */
  drafts: DraftBinding;
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
  /** Restore an archived chat to the live list — the mirror of `archive`. */
  unarchive: (chat: { id: number; title: string }) => Promise<void>;
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

/**
 * The history-row marker status of one chat, from the global run state's two id sets.
 * Awaiting (paused on a question/confirm) wins over running — the sets are disjoint
 * in the store, so precedence only matters for a stale memo — and a chat in neither
 * shows no marker (null).
 */
export function runStatusOf(awaiting: ReadonlySet<number>, running: ReadonlySet<number>, id: number): ChatRunStatus {
  return awaiting.has(id) ? 'awaiting' : running.has(id) ? 'running' : null;
}

const TAIL_LIMIT = 25;

/**
 * True when the chat's message tail is BLOCKED on an unanswered `ask_user` — the same
 * predicate (`selectPendingAskUser`) the in-chat banner and the diagnostics derive the
 * pending question from, so the history marker can never disagree with either. A
 * pending question is always at the transcript TAIL (a later user turn answers it), so
 * a bounded tail read is enough — never the full transcript.
 */
export function hasPendingAskUser(messages: readonly { id: number; role: string; content: unknown }[]): boolean {
  const like = messages
    .filter((m) => typeof m.content === 'string')
    .map((m) => ({ id: m.id, role: m.role, content: m.content as string }));
  return selectPendingAskUser(like) != null;
}

export function useVsCodeChats(init: InitData, newChatLabel: string): VsCodeChats {
  const [chatId, setActiveId] = useState<number | null>(null);
  const brainChats = useBrainChats({
    pinnedProjectId: init.project?.id ?? null,
    activeChatId: chatId,
    onActiveChatChange: setActiveId,
    placeholderTitles: [newChatLabel],
  });
  const { chats, select, setMemoryEnabled, rename, autoTitle, captureOriginalRequest, reload, summarize, setError } = brainChats;
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
  const { remove: removeChat, archive: archiveChat, unarchive: unarchiveChat } = brainChats;
  const remove = useCallback((chat: { id: number; title: string }) => removeChat(chat.id), [removeChat]);
  const archive = useCallback((chat: { id: number; title: string }) => archiveChat(chat.id), [archiveChat]);
  const unarchive = useCallback((chat: { id: number; title: string }) => unarchiveChat(chat.id), [unarchiveChat]);
  const clearError = useCallback(() => setError(''), [setError]);

  // The auto-archive sweep: a live chat idle for at least `autoArchiveAfterDays` (last
  // touched / last executed) archives itself so the history stays short without a
  // manual pass. It runs when the list lands or the threshold changes — not on a timer
  // (a chat cannot go stale while the panel is open and watching it) — and it never
  // touches the open chat or one with a live run, since a chat that is IN USE is not
  // idle. A non-positive threshold disables the sweep. Each archive goes through the
  // store, so the list and the Sessions tree update through the one existing seam.
  const archiveThresholdDays = init.autoArchiveAfterDays ?? 5;
  const archiveRef = useRef(archive);
  archiveRef.current = archive;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  // `chatIdRef` (the chat.deleted handler above) is the same truth the sweep reads —
  // declared once, read by both. A duplicate declaration here shadowed it and broke the build.
  useEffect(() => {
    if (archiveThresholdDays <= 0) return;
    const threshold = archiveThresholdDays;
    const stale = chatsRef.current.filter(
      (chat) => chat.id !== chatIdRef.current && (daysIdleOf(chat) ?? 0) >= threshold,
    );
    for (const chat of stale) {
      void archiveRef.current(chat).catch(() => {
        // One failure must not stop the rest of the sweep; the next list reload retries it.
      });
    }
  }, [archiveThresholdDays, chats]);

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

  // A chat paused on a question ALSO marks its row when the live run-state is gone —
  // the sets above hold a chat only while its run is live in THIS webview, so after a
  // reload/reopen a chat that ended on an `ask_user` would show no '?' while the
  // diagnostics (derived from the persisted transcript) still listed the question.
  // Derive 'awaiting' from each listed chat's stored tail through the shared predicate,
  // refreshed whenever the list re-reads (a send/answer bumps the chat's stamp, so the
  // list reload clears or sets the marker without a manual refresh). One bounded tail
  // read per chat — a pending ask is necessarily at the tail.
  const persistence = useMemo(() => createHostPersistence(), []);
  const [durableAwaiting, setDurableAwaiting] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    const ids = chats.map((c) => c.id);
    if (ids.length === 0) {
      setDurableAwaiting((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    void Promise.all(
      ids.map((id) =>
        persistence
          .getMessages(id, TAIL_LIMIT)
          .then((messages) => ({ id, pending: hasPendingAskUser(messages) }))
          .catch(() => ({ id, pending: false })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setDurableAwaiting(new Set(results.filter((r) => r.pending).map((r) => r.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [persistence, chats]);

  const runStatus = useCallback(
    (id: number): ChatRunStatus =>
      awaitingSet.has(id) || durableAwaiting.has(id)
        ? 'awaiting'
        : runningSet.has(id)
          ? 'running'
          : null,
    [awaitingSet, runningSet, durableAwaiting],
  );
  const titleOf = useCallback(
    (chat: BrainChat) => (!chat.title || chat.title === DEFAULT_CHAT_TITLE ? newChatLabel : chat.title),
    [newChatLabel],
  );

  // The first send creates the chat — ONE creation even if a second send lands while it
  // is in flight — scoped to the sidebar's active project (the hook's pin), in the armed
  // mode; its first user turn names it and records the request it was asked (1245).
  const { ensureChatId: ensureCreated, onFirstUserTurn, drafts } = useChatCreation({
    chatId,
    create: async () => (await createArmed())?.id ?? null,
    autoTitle,
    onCaptureOriginalRequest: captureOriginalRequest,
  });
  const ensureChatId = useCallback(async (draft?: DraftToken) => {
    const id = await ensureCreated(draft);
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
    chatId, setChatId, chats, archivedChats: brainChats.archivedChats, chatOptions, activeChat, reloadChats, onFirstUserTurn, ensureChatId, drafts,
    runStatus, titleOf, chatMode, selectMode, setMemoryEnabled, armMemory, rename, summarize, confirmDelete, archive, unarchive, remove,
    loading: brainChats.loading, error: brainChats.error, clearError,
  };
}
