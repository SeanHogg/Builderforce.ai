// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { defaultInferenceMode, isInferenceMode, type InferenceMode } from '@builderforce/local-first';
import { inferenceModeOption, useInferenceModeGate, type InferenceModeGate, type PromptOptionsInferenceMode } from '@seanhogg/builderforce-brain-ui';
import {
  WEB_INFERENCE_MODE_STORAGE_KEY,
  notifyWebInferenceMode,
  readStoredInferenceMode,
  subscribeWebInferenceMode,
  webSignedIn,
  writeStoredInferenceMode,
} from './webInferenceMode';

function subscribe(listener: () => void): () => void {
  // The policy notifies on every re-apply — a mode choice, a session change in this tab
  // (`refreshWebPlatformPolicy`), or anything another tab changed (its storage listener).
  const stop = subscribeWebInferenceMode(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === WEB_INFERENCE_MODE_STORAGE_KEY) listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    stop();
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** One primitive snapshot (stored mode + signed-in), so an unchanged state never re-renders. */
const snapshot = (): string => `${readStoredInferenceMode() ?? ''}|${webSignedIn() ? 1 : 0}`;
const serverSnapshot = (): string => '|0';

/**
 * Store the choice now (the hook re-reads it at once), then let the policy apply it. An
 * ANONYMOUS visitor choosing a mode that reaches the gateway (Hybrid, Specific) is opting
 * in to the guest allowance, so this is where the guest token is minted (room-aware,
 * `ensureGuestToken`) — resolved before the held turn is sent, so that turn goes
 * authenticated. Signed in, or on Local only, nothing is minted.
 */
export async function chooseWebInferenceMode(mode: InferenceMode): Promise<void> {
  writeStoredInferenceMode(mode);
  notifyWebInferenceMode();
  const policy = await import('./platformPolicy');
  policy.setWebInferenceMode(mode);
  if (mode !== 'local-only' && !webSignedIn()) {
    const { ensureGuestToken } = await import('../guestRoomApi');
    await ensureGuestToken();
  }
}

/**
 * The web's inference mode for the composer's `/` menu and first-run question: the
 * stored choice, else the default for whether the person is signed in — THE web's one
 * definition, `webSignedIn` (a web or tenant session; a guest token is not one: signed
 * in = Hybrid, signed out = Local only). `needsChoice` — never asked, signed in OR
 * anonymous — makes the shared first-run gate ask once before the next turn: for a
 * signed-in person it confirms Hybrid, for an anonymous visitor it is the Hybrid opt-in
 * (choosing it mints the guest allowance). The policy module is imported lazily, so a
 * surface that only shows the mode does not pull the platform gate into its chunk.
 */
export function useWebInferenceMode(): PromptOptionsInferenceMode & { chosen: boolean; signedIn: boolean } {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const onChange = useCallback((mode: InferenceMode) => chooseWebInferenceMode(mode), []);
  return useMemo(() => {
    const [rawMode, rawSignedIn] = state.split('|');
    const stored = isInferenceMode(rawMode) ? rawMode : null;
    const signedIn = rawSignedIn === '1';
    const chosen = stored !== null;
    return {
      ...inferenceModeOption({ value: stored ?? defaultInferenceMode({ signedIn }), chosen, onChange }),
      chosen,
      signedIn,
    };
  }, [state, onChange]);
}

/**
 * THE web's turn door: the mode (above) and THE first-run gate over it
 * (`useInferenceModeGate`). Every web host that starts turns ITSELF — the canvas and
 * Studio (the entry prompt, an object asking Brain, a queued turn), the signed-in Brain
 * panel's seed prompt — sends through `gate.request` and hands `gate` to its composer as
 * `modeGate`, so the question shows in that composer whichever way the turn started and
 * no turn ever runs before the person chose where models run.
 */
export function useWebTurnGate(): { inference: ReturnType<typeof useWebInferenceMode>; gate: InferenceModeGate } {
  const inference = useWebInferenceMode();
  const gate = useInferenceModeGate(inference);
  return { inference, gate };
}
