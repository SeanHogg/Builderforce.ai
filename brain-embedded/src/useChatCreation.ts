'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDraftBinding, type DraftBinding } from './draftBinding';

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
 * send), title through `useBrainChats.autoTitle` and record the first prompt through
 * `useBrainChats.captureOriginalRequest`; Rovr creates in its device record.
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
  /**
   * Optional: keep the user's FIRST prompt verbatim on the chat (migration 1245) so a
   * chat linked to a ticket still shows the request that produced it — the title is a
   * ~60-char derivation and loses the origin text.
   *
   * Same contract as `autoTitle`, deliberately: it is fired from the same place, in the
   * same turn, so the two can never drift apart, and it is NOT awaited — the first user
   * turn must never wait on, or fail because of, a bookkeeping write. Because nothing
   * awaits it, the port OWNS its failure: it must catch and report its own rejection
   * (as `useBrainChats.captureOriginalRequest` does) — one it lets escape is an
   * unhandled rejection. A host that does not pass it is unaffected.
   */
  onCaptureOriginalRequest?: (chatId: number, text: string) => Promise<void> | void;
}

export interface ChatCreation {
  /**
   * The open chat's id, or the one the first send creates. Concurrent calls on a draft
   * share ONE creation. Rejects when `create` throws; resolves null when it gave up.
   */
  ensureChatId: () => Promise<number | null>;
  /** Fire the `autoTitle` port for a chat's first user turn; never rejects. */
  onFirstUserTurn: (chatId: number, firstUserText: string) => Promise<void>;
  /**
   * The draft's binding to its creation (`draftBinding.ts`): the token a send from the draft is minted, the creation started for it
   * resolves or fails it. The turn door reads it (`useChatTurns({ drafts })`) so what is typed while the chat is being created
   * lands in THAT chat, whatever is showing when its id arrives. Stable identity.
   */
  drafts: DraftBinding;
}

export function useChatCreation({ chatId, create, autoTitle, onCaptureOriginalRequest }: ChatCreationOptions): ChatCreation {
  const chatIdRef = useRef(chatId);
  // eslint-disable-next-line react-hooks/refs
  chatIdRef.current = chatId;
  const createRef = useRef(create);
  // eslint-disable-next-line react-hooks/refs
  createRef.current = create;
  const autoTitleRef = useRef(autoTitle);
  // eslint-disable-next-line react-hooks/refs
  autoTitleRef.current = autoTitle;
  const captureRef = useRef(onCaptureOriginalRequest);
  // eslint-disable-next-line react-hooks/refs
  captureRef.current = onCaptureOriginalRequest;

  /** The draft's token <-> creation binding. One per mount. */
  const [drafts] = useState(createDraftBinding);
  /** The first message's creation while it is in flight (or resolved but not yet selected). */
  const creating = useRef<Promise<number | null> | null>(null);
  useEffect(() => {
    if (chatId == null) return;
    creating.current = null;
    drafts.leave(); // the draft is gone; a creation still in flight answers its own token, nobody else's
  }, [chatId, drafts]);

  const ensureChatId = useCallback((): Promise<number | null> => {
    const open = chatIdRef.current;
    if (open != null) return Promise.resolve(open);
    if (!creating.current) {
      // This creation belongs to the draft's token, and only it settles that token. When a later creation has replaced
      // it (the draft was left and another begun) its late answer must not clear that one.
      const token = drafts.adopt();
      drafts.startCreation(token);
      const mine: Promise<number | null> = (async () => createRef.current())().then(
        (id) => {
          if (id == null) {
            if (creating.current === mine) creating.current = null;
            drafts.fail(token);
          } else drafts.resolve(token, id);
          return id;
        },
        (error: unknown) => {
          if (creating.current === mine) creating.current = null;
          drafts.fail(token);
          throw error;
        },
      );
      creating.current = mine;
    }
    return creating.current;
  }, [drafts]);

  const onFirstUserTurn = useCallback(async (id: number, firstUserText: string) => {
    // The origin-text capture is fired HERE, beside the auto-title, so it cannot drift
    // from it: every host that titles a chat from its first turn captures the request
    // from that same turn. Fired before, and not behind, `autoTitle`'s await so the
    // capture never waits on that latency or its rejection; the port owns its failure.
    void captureRef.current?.(id, firstUserText);
    await autoTitleRef.current?.(id, firstUserText);
  }, []);

  return { ensureChatId, onFirstUserTurn, drafts };
}
