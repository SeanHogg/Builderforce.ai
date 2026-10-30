'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDraftBinding, type DraftBinding, type DraftToken } from './draftBinding';

/**
 * "The first message creates the chat" — the ONE implementation. Extracted from the
 * web Brain panel (`useBrainChatStart.ensureChatId`), the editor chat list
 * (`useVsCodeChats.ensureChatId` / `autoTitleChat`) and Rovr's in-flight creation ref,
 * which each kept a copy.
 *
 * What it guarantees:
 *  - **One create per draft.** A second send that arrives while the first message's
 *    chat is still being created JOINS that creation instead of minting a second chat
 *    (and splitting the conversation across two). The creation is the DRAFT TOKEN's: a send
 *    names its token (`ensureChatId(token)`) and gets the creation of THAT token - a late send
 *    of an abandoned draft creates its own chat, and never takes the one a newer draft made.
 *    The in-flight promise is dropped on failure (so a retry creates) and once the host is on
 *    a real chat.
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
   * The open chat's id, or the one the first send creates. Concurrent calls with the same `draft` token share ONE creation;
   * a call under another draft's token never joins it (and is never joined by it). Without a token (a caller outside the
   * turn door) it is the draft on screen's. Rejects when `create` throws; resolves null when it gave up.
   */
  ensureChatId: (draft?: DraftToken) => Promise<number | null>;
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
  /** Each draft token's creation while it is in flight (or resolved but not yet selected). */
  const creations = useRef(new Map<DraftToken, Promise<number | null>>());
  /** Tokens whose creation resolved: their entry goes once the host is on a real chat. */
  const resolved = useRef(new Set<DraftToken>());
  useEffect(() => {
    if (chatId == null) return;
    for (const token of resolved.current) creations.current.delete(token);
    resolved.current.clear();
    drafts.leave(); // the draft is gone; a creation still in flight answers its own token, nobody else's
  }, [chatId, drafts]);

  const ensureChatId = useCallback((draft?: DraftToken): Promise<number | null> => {
    const open = chatIdRef.current;
    if (open != null) return Promise.resolve(open);
    // This creation belongs to the token the send began with, and only it settles that token: a late send of an abandoned
    // draft creates for ITS token, and its answer never clears (or becomes) the chat a newer draft made.
    const token = draft ?? drafts.adopt();
    const existing = creations.current.get(token);
    if (existing) return existing;
    drafts.startCreation(token);
    const mine: Promise<number | null> = (async () => createRef.current())().then(
      (id) => {
        if (id == null) {
          creations.current.delete(token);
          drafts.fail(token);
        } else if (chatIdRef.current != null) {
          creations.current.delete(token);
          drafts.resolve(token, id);
        } else {
          resolved.current.add(token);
          drafts.resolve(token, id);
        }
        return id;
      },
      (error: unknown) => {
        creations.current.delete(token);
        drafts.fail(token);
        throw error;
      },
    );
    creations.current.set(token, mine);
    return mine;
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
