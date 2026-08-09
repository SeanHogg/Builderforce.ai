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
 * The fetch is lazy: it happens on the first mount that needs it, once per page
 * lifetime, and after that a mutation updates the store in place.
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
}

const EMPTY: BetaState = { betas: [], bannerBetaId: null, loaded: false };

let state: BetaState = EMPTY;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(next: BetaState) => void>();

function publish(next: BetaState): void {
  state = next;
  subscribers.forEach((fn) => fn(next));
}

/** Load once per page lifetime. A failure is silent and re-armed: a beta invite
 *  is never worth an error surface, and the next mount may well succeed. */
function loadOnce(): Promise<void> {
  if (state.loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = fetchBetaPrograms()
      .then(({ betas, bannerBetaId }) => publish({ betas, bannerBetaId, loaded: true }))
      .catch(() => { publish({ ...EMPTY, loaded: true }); })
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

  useEffect(() => {
    // No session, no betas — and no request. Enrolment is per person, so there
    // is nothing to ask about until someone is signed in.
    if (!getStoredWebToken()) return undefined;
    subscribers.add(setLocal);
    void loadOnce();
    return () => { subscribers.delete(setLocal); };
  }, []);

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
