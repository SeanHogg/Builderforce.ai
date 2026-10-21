/**
 * The web's persisted INFERENCE MODE — Local only · Hybrid · Specific — the one choice a
 * person sees (`@builderforce/local-first` derives the platform capabilities from it).
 *
 * Only an explicit choice is stored (`bf_inference_mode_v1`); an unset mode is re-derived
 * per read from whether the person is signed in ({@link webSignedIn}), so an undecided
 * person moves onto Hybrid the moment they sign in. Mirrored across tabs through the storage event by the policy
 * module, which owns applying it (`setWebInferenceMode` in `./platformPolicy`).
 *
 * No `'use client'`: a plain module that guards on `window` through `../storage`.
 */
import { defaultInferenceMode, isInferenceMode, type InferenceMode } from '@builderforce/local-first';
import { getStoredTenantToken, getStoredWebToken } from '../auth';
import { readLocal, removeLocal, writeLocal } from '../storage';

export const WEB_INFERENCE_MODE_STORAGE_KEY = 'bf_inference_mode_v1';

/**
 * THE web's "signed in" — the ONE answer the mode's default (`platformPolicy`), the Brain
 * stream's no-model verdict (`lib/brain/localFirst`) and the composer's first-run question
 * (`useWebInferenceMode`) all read. Signed in = a web or tenant SESSION is stored.
 *
 * A guest's minted token is NOT a session (operator decision: Rovr and Studio are used
 * anonymously). An anonymous visitor defaults to Local only; Hybrid is their explicit
 * opt-in, and choosing it is what mints the guest allowance — so a mint can never move
 * a visitor onto Hybrid behind their back.
 *
 * Read live from storage, never cached: a sign-in or a sign-out in
 * this tab is seen by the very next read. Reads presence only — never a token's contents.
 */
export function webSignedIn(): boolean {
  return !!(getStoredWebToken() || getStoredTenantToken());
}

/** The stored explicit choice, or null when the person never chose (or it is unreadable). */
export function readStoredInferenceMode(): InferenceMode | null {
  const raw = readLocal(WEB_INFERENCE_MODE_STORAGE_KEY);
  return isInferenceMode(raw) ? raw : null;
}

/**
 * The mode in force right now — the stored choice, else the default for whether a session
 * is present (anonymous = Local only). For code that decides without the policy module
 * (the guest mint, the canvas's guest tools); `useWebInferenceMode` is the hook twin.
 */
export function webInferenceModeNow(): InferenceMode {
  return readStoredInferenceMode() ?? defaultInferenceMode({ signedIn: webSignedIn() });
}

export function writeStoredInferenceMode(mode: InferenceMode | null): void {
  if (mode === null) removeLocal(WEB_INFERENCE_MODE_STORAGE_KEY);
  else writeLocal(WEB_INFERENCE_MODE_STORAGE_KEY, mode);
}

const listeners = new Set<() => void>();

/** Called on any change to the mode or to what it derives from (sign-in, another tab). */
export function subscribeWebInferenceMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyWebInferenceMode(): void {
  for (const listener of [...listeners]) listener();
}
