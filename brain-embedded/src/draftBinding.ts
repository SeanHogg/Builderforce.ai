/**
 * A draft chat's first send CREATES the chat, and what the person types while it does belongs to THAT creation - not to
 * whichever chat is showing when the id arrives.
 *
 * A DRAFT TOKEN is minted when a send starts from a draft (`begin`, synchronously - before any async preparation the host's
 * send does). Every turn held while the draft is unresolved carries the token, never a chat id. The creation started for the
 * token resolves it with its chat id, or fails it; only the creation that BELONGS to a token can settle it, so an abandoned,
 * older creation resolving late settles its own token and no other draft's. Switching the visible chat touches no token.
 *
 * Pure (no React): `useChatCreation` owns one binding and reports into it; `useChatTurns` / `useQueuedTurns` read it.
 */

/** Names one draft's send-and-creation. Opaque; only compare it. */
export type DraftToken = number;

/** The id a token's creation resolved with, or null when it failed (nothing was created). */
export type DraftOutcome = number | null;

export interface DraftBinding {
  /**
   * A send starts from the draft: its token (the draft's current one, minted when it has none). Counts the send, so the
   * token is not failed while another send from the same draft is still getting ready; pair every call with `settle`.
   */
  begin: () => DraftToken;
  /** The same token without counting a send - the creation (`ensureChatId`) adopts the draft's token this way. */
  adopt: () => DraftToken;
  /** The draft on screen's token (null: none yet, or the draft has been left). Stable between changes. */
  current: () => DraftToken | null;
  /** The creation for this token has started: it, and only it, will resolve or fail the token. */
  startCreation: (token: DraftToken) => void;
  resolve: (token: DraftToken, chatId: number) => void;
  fail: (token: DraftToken) => void;
  /**
   * A send that `begin` counted has ended. A token whose every send ended without a creation ever starting has nothing
   * coming: it fails (its held turns go back to the composer).
   */
  settle: (token: DraftToken) => void;
  /** A chat was opened: the draft is no longer on screen. Its tokens stay open - their creations may still answer. */
  leave: () => void;
  /** What a token's creation answered: the chat id, null if it failed, undefined while open. */
  outcomeOf: (token: DraftToken) => DraftOutcome | undefined;
  /** Called whenever `current()` changes (a `useSyncExternalStore` subscription). */
  subscribe: (listener: () => void) => () => void;
  /** Called once per token, when its creation answers. */
  onOutcome: (listener: (token: DraftToken, outcome: DraftOutcome) => void) => () => void;
}

interface Entry {
  sends: number;
  creating: boolean;
  outcome: DraftOutcome | undefined;
}

export function createDraftBinding(): DraftBinding {
  let seq = 0;
  let live: DraftToken | null = null;
  const tokens = new Map<DraftToken, Entry>();
  const watchers = new Set<() => void>();
  const listeners = new Set<(token: DraftToken, outcome: DraftOutcome) => void>();

  const setLive = (token: DraftToken | null): void => {
    if (live === token) return;
    live = token;
    for (const watcher of [...watchers]) watcher();
  };
  const adopt = (): DraftToken => {
    if (live !== null) return live;
    seq += 1;
    tokens.set(seq, { sends: 0, creating: false, outcome: undefined });
    setLive(seq);
    return seq;
  };
  const finish = (token: DraftToken, outcome: DraftOutcome): void => {
    const entry = tokens.get(token);
    if (!entry || entry.outcome !== undefined) return;
    entry.outcome = outcome;
    if (outcome === null && live === token) setLive(null);
    for (const listener of [...listeners]) listener(token, outcome);
    // A resolved token still on screen keeps its answer (a turn typed before the chat is selected lands at once);
    // every other one has delivered it.
    if (live !== token) tokens.delete(token);
  };

  return {
    begin: () => {
      const token = adopt();
      tokens.get(token)!.sends += 1;
      return token;
    },
    adopt,
    current: () => live,
    startCreation: (token) => {
      const entry = tokens.get(token);
      if (entry) entry.creating = true;
    },
    resolve: (token, chatId) => finish(token, chatId),
    fail: (token) => finish(token, null),
    settle: (token) => {
      const entry = tokens.get(token);
      if (!entry) return;
      entry.sends -= 1;
      if (entry.sends <= 0 && !entry.creating && entry.outcome === undefined) finish(token, null);
    },
    leave: () => {
      const left = live;
      if (left === null) return;
      setLive(null);
      if (tokens.get(left)?.outcome !== undefined) tokens.delete(left);
    },
    outcomeOf: (token) => tokens.get(token)?.outcome,
    subscribe: (listener) => {
      watchers.add(listener);
      return () => { watchers.delete(listener); };
    },
    onOutcome: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** A binding nobody drives: what a host without draft creation (the Creation Canvas) is given. */
export const NO_DRAFTS: DraftBinding = createDraftBinding();
