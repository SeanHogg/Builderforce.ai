'use client';

import { useState, useEffect } from 'react';
import { APP_VERSION, fetchApiVersion } from '@/lib/appVersions';
import { fetchLegalCurrent, type LegalCurrent } from '@/lib/legalDocs';

export type { LegalCurrent, LegalDocument } from '@/lib/legalDocs';

export interface LegalDocsState {
  /**
   * Build-time UI version (`NEXT_PUBLIC_APP_VERSION`) — **null until mounted**, and
   * that is the whole point.
   *
   * ── WHY IT IS NOT SIMPLY `APP_VERSION` ─────────────────────────────────────────
   * It is inlined by `next.config.js` from `package.json` at COMPILE time: into the
   * client chunks when they are built, and into the server bundle when it is built.
   * A build-identity string is the one value in the app whose entire purpose is to
   * differ between builds — so the moment the running server and the client chunk in
   * the browser come from different builds (a redeploy while a cached chunk is still
   * being served; a rebuilt server against warm client assets), the server renders
   * one number and the client renders another IN THE SAME TEXT NODE.
   *
   * React does not shrug at that. A text mismatch during hydration throws away the
   * whole server tree and re-renders the entire app on the client (React #418) — the
   * heaviest possible outcome for the least important string on the page, and it was
   * observed doing exactly that on the canvas route: server `2026.8.60`, client
   * `2026.8.56`, one `<button>` in the sidebar's legal strip.
   *
   * So the version is deliberately absent from the first render, exactly as the
   * theme, the auth session and the sidebar's collapsed state already are, and
   * arrives on the commit after mount — where it can only ever be the version of the
   * bundle that is actually running.
   */
  appVersion: string | null;
  /** Live API version from /health, null until loaded. */
  apiVersion: string | null;
  /** Current legal documents, null until loaded. */
  legal: LegalCurrent | null;
  termsVersion?: string;
  privacyVersion?: string;
}

/**
 * Shared source of truth for the footer/sidebar legal + version chrome: the
 * build-time UI version, the live API version, and the current Terms/Privacy
 * docs. Both the auth-screen footer and the sidebar menu read from here so the
 * fetch + shapes live in exactly one place.
 *
 * The document read itself lives in `lib/legalDocs`, shared with the public
 * `/legal/terms` and `/legal/privacy` pages — the panel and the page must never
 * be able to show different versions of the same instrument.
 */
export function useLegalDocs(): LegalDocsState {
  const [legal, setLegal] = useState<LegalCurrent | null>(null);
  const [apiVersion, setApiVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // After mount, so the server's build stamp and the browser's can never be
    // compared — see the field's note. It is a constant, so no cleanup guard.
    setAppVersion(APP_VERSION);
    void fetchLegalCurrent().then((data) => {
      if (!cancelled && data) setLegal(data);
    });
    // Shared cache — the footer, the sidebar menu and a Brain diagnostics capture
    // all read the same session-cached value instead of each hitting /health.
    void fetchApiVersion().then((v) => { if (!cancelled && v) setApiVersion(v); });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    appVersion,
    apiVersion,
    legal,
    termsVersion: legal?.terms?.version,
    privacyVersion: legal?.privacy?.version,
  };
}
