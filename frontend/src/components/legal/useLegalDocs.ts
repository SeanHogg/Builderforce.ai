'use client';

import { useState, useEffect } from 'react';
import { APP_VERSION, fetchApiVersion } from '@/lib/appVersions';

const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

export interface LegalDocument {
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

export interface LegalCurrent {
  terms: LegalDocument;
  privacy: LegalDocument;
}

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
 */
export function useLegalDocs(): LegalDocsState {
  const [legal, setLegal] = useState<LegalCurrent | null>(null);
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${AUTH_API_URL}/api/auth/legal/current`, { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LegalCurrent | null) => {
        if (!cancelled && data?.terms && data?.privacy) setLegal(data);
      })
      .catch(() => {});
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
