'use client';

import { useState, useEffect } from 'react';
import { APP_VERSION, fetchApiVersion } from '@/lib/appVersions';
import { fetchLegalCurrent, type LegalCurrent } from '@/lib/legalDocs';

export type { LegalCurrent, LegalDocument } from '@/lib/legalDocs';

export interface LegalDocsState {
  /** Build-time UI version (NEXT_PUBLIC_APP_VERSION). */
  appVersion: string;
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

  useEffect(() => {
    let cancelled = false;
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
    appVersion: APP_VERSION,
    apiVersion,
    legal,
    termsVersion: legal?.terms?.version,
    privacyVersion: legal?.privacy?.version,
  };
}
