'use client';

/**
 * Product updates on the client — ONE store behind every surface that shows a
 * beta, and behind the unread badge on the version chip.
 *
 * Both are answers to "what does this person need told about product updates?",
 * both come from the same signed-in read, and both are session-scoped in exactly
 * the same way — so a second store would be a second request, a second cache and
 * a second chance to show the previous person in this tab someone else's state.
 *
 * The banner, the join panel and the "What's new" changelog all ask the same two
 * questions ("which betas can I join?", "where do I stand with this one?"), and
 * they must never answer them differently: joining from the panel has to clear
 * the banner in the same tick, without a refetch and without either component
 * knowing the other exists. So the state lives here, in a module store with
 * subscribers, and the components are views of it.
 *
 * Signed-out visitors cost nothing — there is no token, so there is no fetch.
 * The fetch is lazy: it happens on the first mount that needs it, once per
 * SESSION, and after that a mutation updates the store in place.
 *
 * Session, not page: signing out is a state change here, not a reload, so a
 * module-level cache would otherwise show the next person to use this tab the
 * standing of the last one. The loaded state remembers WHOSE it is and is
 * dropped the moment the token changes — including to none.
 */

import { useCallback, useEffect, useState } from 'react';
import { getStoredWebToken } from './auth';
import {
  fetchBetaPrograms,
  markProductUpdatesSeen,
  setBetaEnrollment,
  type BetaAction,
  type BetaProgram,
} from './releaseNotesApi';

interface BetaState {
  betas: BetaProgram[];
  /** The server's choice of which beta is worth a banner — never the client's. */
  bannerBetaId: string | null;
  /** Published notes this user has not seen — the badge on the version chip. */
  unread: number;
  loaded: boolean;
  /** The session this state describes. null = nobody's, i.e. signed out. */
  owner: string | null;
}

const EMPTY: BetaState = { betas: [], bannerBetaId: null, unread: 0, loaded: false, owner: null };

let state: BetaState = EMPTY;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(next: BetaState) => void>();

function publish(next: BetaState): void {
  state = next;
  subscribers.forEach((fn) => fn(next));
}

/** Load once per session. A failure is silent and re-armed on the next session:
 *  a beta invite is never worth an error surface. */
function loadOnce(token: string): Promise<void> {
  if (state.loaded && state.owner === token) return Promise.resolve();
  if (!inFlight) {
    inFlight = fetchBetaPrograms()
      .then(({ betas, bannerBetaId, unreadCount }) => publish({
        betas, bannerBetaId, unread: unreadCount, loaded: true, owner: token,
      }))
      .catch(() => { publish({ ...EMPTY, loaded: true, owner: token }); })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * Reflect a join/leave/dismiss locally the moment it is requested.
 *
 * The banner must disappear on click, not one round trip later, and the panel's
 * "you are in this beta" state has to flip just as promptly. The request is
 * still authoritative — a failure rolls the store back.
 */
function applyStatus(id: string, myStatus: BetaProgram['myStatus']): BetaState {
  return {
    ...state,
    betas: state.betas.map((b) => (b.id === id ? { ...b, myStatus } : b)),
    // Any answer at all retires the banner for this beta.
    bannerBetaId: state.bannerBetaId === id && myStatus !== null ? null : state.bannerBetaId,
  };
}

export interface UseBetaPrograms {
  betas: BetaProgram[];
  /** The beta to interrupt this person about, or null. */
  banner: BetaProgram | null;
  loaded: boolean;
  /** Join / leave / dismiss. `agreed` is required by the server for a join. */
  act: (id: string, action: BetaAction, agreed?: boolean) => Promise<void>;
}

/**
 * The unread badge, for the version chips that open the changelog.
 *
 * It is a READ of the same store the beta banner uses, so the request that
 * populates it is the one the app already makes — mounting a badge on the footer
 * costs nothing extra, and a signed-out visitor still costs no request at all.
 */
export function useProductUpdatesUnread(): number {
  return useBetaState().unread;
}

/**
 * Opening the panel IS reading the changelog, so the badge clears here rather
 * than behind a second "mark as read" the user would have to find. Local first
 * (the badge must go on click, not one round trip later) and the request is
 * fire-and-forget: a failure means the same count comes back next session, which
 * is the harmless direction.
 */
export function markProductUpdatesRead(): void {
  if (state.unread === 0) return;
  publish({ ...state, unread: 0 });
  void markProductUpdatesSeen().catch(() => {});
}

/** Subscribe to the store and load it once per session. Shared by both hooks so
 *  the sign-in/sign-out handling exists exactly once. */
function useBetaState(): BetaState {
  const [local, setLocal] = useState<BetaState>(state);
  // Read per render rather than once: signing in or out re-renders everything
  // under the auth provider, and that re-render is the signal this store gets.
  const token = getStoredWebToken();

  useEffect(() => {
    // Subscribe BEFORE deciding anything: the sign-out path below clears the
    // store, and a view that had not subscribed yet would keep rendering the
    // previous person's banner until something unrelated re-rendered it.
    subscribers.add(setLocal);
    setLocal(state); // catch any change between this render and this effect

    if (!token) {
      // No session, no betas — and no request. Whatever the previous person in
      // this tab had loaded goes with them.
      if (state !== EMPTY) publish(EMPTY);
    } else {
      if (state.owner !== null && state.owner !== token) publish(EMPTY);
      void loadOnce(token);
    }
    return () => { subscribers.delete(setLocal); };
  }, [token]);

  return local;
}

export function useBetaPrograms(): UseBetaPrograms {
  const local = useBetaState();

  const act = useCallback(async (id: string, action: BetaAction, agreed = false) => {
    const previous = state;
    const optimistic = action === 'join' ? 'joined' : action === 'leave' ? 'left' : 'dismissed';
    publish(applyStatus(id, optimistic));
    try {
      const confirmed = await setBetaEnrollment(id, action, agreed);
      publish(applyStatus(id, confirmed));
    } catch (err) {
      publish(previous);
      throw err;
    }
  }, []);

  return {
    betas: local.betas,
    banner: local.betas.find((b) => b.id === local.bannerBetaId) ?? null,
    loaded: local.loaded,
    act,
  };
}
