'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * "The first message creates the chat" — the ONE implementation. Extracted from the
 * web Brain panel (`useBrainChatStart.ensureChatId`), the editor chat list
 * (`useVsCodeChats.ensureChatId` / `autoTitleChat`) and Rovr's in-flight creation ref,
 * which each kept a copy.
 *
 * What it guarantees:
 *  - **One create per draft.** A second send that arrives while the first message's
 *    chat is still being created JOINS that creation instead of minting a second chat
 *    (and splitting the conversation across two). The in-flight promise is dropped on
 *    failure (so a retry creates) and once the host is on a real chat.
 *  - **An open chat is never re-created.** With `chatId` set, `ensureChatId` resolves
 *    to it.
 *  - **Stable identities.** Both callbacks keep their identity across renders and read
 *    the newest ports through refs — a run captures `ensureChatId` at its start.
 *
 * How the chat is created and named is the HOST's (ports): the web and editor create
 * through `useArmedNewChat().createArmed` (so the armed mode/memory ride the first
 * send) and title through `useBrainChats.autoTitle`; Rovr creates in its device record.
 * A host without chats (the Creation Canvas) does not mount this at all.
 *
 * Mount it BEFORE the conversation: `ensureChatId` and `onFirstUserTurn` are what
 * `useBrainConversation` takes as options.
 */
export interface ChatCreationOptions {
  /** The open chat, or null for a draft the first send must create. */
  chatId: number | null;
  /** Create (and select) the chat; resolves its id, or null when it could not. May throw. */
  create: () => Promise<number | null>;
  /**
   * Optional: name a still-untitled chat from its first user turn. Best-effort, and the
   * port owns its failure: it must not reject (`useBrainChats().autoTitle` keeps the
   * placeholder and re-arms a retry). Omit to leave chats untitled.
   */
  autoTitle?: (chatId: number, firstUserText: string) => Promise<unknown> | void;
}

export interface ChatCreation {
  /**
   * The open chat's id, or the one the first send creates. Concurrent calls on a draft
   * share ONE creation. Rejects when `create` throws; resolves null when it gave up.
   */
  ensureChatId: () => Promise<number | null>;
  /** Fire the `autoTitle` port for a chat's first user turn; never rejects. */
  onFirstUserTurn: (chatId: number, firstUserText: string) => Promise<void>;
}

export function useChatCreation({ chatId, create, autoTitle }: ChatCreationOptions): ChatCreation {
  const chatIdRef = useRef(chatId);
  // eslint-disable-next-line react-hooks/refs
  chatIdRef.current = chatId;
  const createRef = useRef(create);
  // eslint-disable-next-line react-hooks/refs
  createRef.current = create;
  const autoTitleRef = useRef(autoTitle);
  // eslint-disable-next-line react-hooks/refs
  autoTitleRef.current = autoTitle;

  /** The first message's creation while it is in flight (or resolved but not yet selected). */
  const creating = useRef<Promise<number | null> | null>(null);
  useEffect(() => {
    if (chatId != null) creating.current = null;
  }, [chatId]);

  const ensureChatId = useCallback((): Promise<number | null> => {
    const open = chatIdRef.current;
    if (open != null) return Promise.resolve(open);
    creating.current ??= createRef.current().then(
      (id) => {
        if (id == null) creating.current = null;
        return id;
      },
      (error: unknown) => {
        creating.current = null;
        throw error;
      },
    );
    return creating.current;
  }, []);

  const onFirstUserTurn = useCallback(async (id: number, firstUserText: string) => {
    await autoTitleRef.current?.(id, firstUserText);
  }, []);

  return { ensureChatId, onFirstUserTurn };
}
