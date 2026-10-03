// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback } from 'react';
import { getOAuthUrl, getSsoStartUrl } from '@/lib/auth/credentials';

/** Where the pop-up lands once signed in: a page that closes itself. */
export const POPUP_DONE_PATH = '/auth/popup-done';

const POPUP_NAME = 'bf-sign-in';
const POPUP_FEATURES = 'popup=yes,width=520,height=680';

/**
 * Open a provider sign-in (OAuth or SSO) in a pop-up that returns to THIS origin.
 *
 * The pop-up finishes on this origin's `/auth/callback`, which writes the session
 * to localStorage; `AuthProvider` here picks that up from the `storage` event, so
 * the page that opened it signs in without a reload and without needing the
 * opener link (which a cross-origin provider hop may sever).
 *
 * When the browser blocks the pop-up, the same sign-in runs in this tab instead
 * and returns to `returnPath`, so a blocked pop-up never strands the visitor.
 */
export function useSignInPopup(returnPath: string) {
  const open = useCallback((popupUrl: string, fallbackUrl: string): void => {
    const popup = window.open(popupUrl, POPUP_NAME, POPUP_FEATURES);
    if (!popup) window.location.href = fallbackUrl;
  }, []);

  const signInWithProvider = useCallback((provider: string): void => {
    const origin = window.location.origin;
    open(getOAuthUrl(provider, POPUP_DONE_PATH, undefined, origin), getOAuthUrl(provider, returnPath, undefined, origin));
  }, [open, returnPath]);

  const signInWithSso = useCallback((email: string): void => {
    const origin = window.location.origin;
    open(getSsoStartUrl(email, POPUP_DONE_PATH, origin), getSsoStartUrl(email, returnPath, origin));
  }, [open, returnPath]);

  return { signInWithProvider, signInWithSso };
}
