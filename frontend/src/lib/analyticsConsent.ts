/**
 * The visitor's cookie / analytics choice — ONE store, read by the consent card
 * (`CookieConsentManager`, which writes it) and by everything that may only run
 * after an opt-in (GTM, the session recorder — PRD 33 D7).
 *
 * The card used to keep the key and its reader private, so a second consumer
 * would have had to re-read localStorage itself and could never hear a change.
 * Writes go through `writeConsent`, which announces the change in this tab;
 * other tabs hear it through `storage`.
 */
import { useSyncExternalStore } from 'react';
import { readLocalJson, writeLocalJson } from './storage';

export interface ConsentChoice {
  version: 1;
  analytics: boolean;
  marketing: boolean;
  gpc: boolean;
  updatedAt: string;
}

export const CONSENT_STORAGE_KEY = 'builderforce-consent-v1';
export const CONSENT_CHANGED_EVENT = 'builderforce:consent-changed';

export function readConsent(): ConsentChoice | null {
  return readLocalJson<ConsentChoice>(CONSENT_STORAGE_KEY);
}

export function writeConsent(choice: ConsentChoice): void {
  writeLocalJson(CONSENT_STORAGE_KEY, choice);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}

/** Opted in to analytics, and no Global Privacy Control signal overriding it. */
export function hasAnalyticsConsent(): boolean {
  const choice = readConsent();
  return !!choice && choice.analytics === true && choice.gpc !== true;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === CONSENT_STORAGE_KEY) onChange(); };
  window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Live analytics consent; false on the server and until the visitor opts in. */
export function useAnalyticsConsent(): boolean {
  return useSyncExternalStore(subscribe, hasAnalyticsConsent, () => false);
}
