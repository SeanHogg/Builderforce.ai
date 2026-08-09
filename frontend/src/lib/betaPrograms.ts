'use client';

/**
 * Beta enrolment on the client — ONE store, shared by every surface that shows a
 * beta.
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
  setBetaEnrollment,
  type BetaAction,
  type BetaProgram,
} from './releaseNotesApi';

interface BetaState {
  betas: BetaProgram[];
  /** The server's choice of which beta is worth a banner — never the client's. */
  bannerBetaId: string | null;
  loaded: boolean;
  /** The session this state describes. null = nobody's, i.e. signed out. */
  owner: string | null;
}

const EMPTY: BetaState = { betas: [], bannerBetaId: null, loaded: false, owner: null };

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
      .then(({ betas, bannerBetaId }) => publish({ betas, bannerBetaId, loaded: true, owner: token }))
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

export function useBetaPrograms(): UseBetaPrograms {
  const [local, setLocal] = useState<BetaState>(state);
  // Read per render rather than once: signing in or out re-renders everything
  // under the auth provider, and that re-render is the signal this store gets.
  const token = getStoredWebToken();

  useEffect(() => {
    // No session, no betas — and no request. Whatever the previous person in
    // this tab had loaded goes with them.
    if (!token) {
      if (state.owner !== null || state.loaded) publish(EMPTY);
      return undefined;
    }
    subscribers.add(setLocal);
    if (state.owner !== null && state.owner !== token) publish(EMPTY);
    void loadOnce(token);
    return () => { subscribers.delete(setLocal); };
  }, [token]);

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
