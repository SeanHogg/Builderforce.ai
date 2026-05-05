'use client';

/**
 * Single source of truth for the post-login onboarding gate.
 *
 * Order of gates (each one blocks rendering of the chrome until satisfied):
 *   1. Authenticated     — webToken present
 *   2. Terms accepted    — userLegalAcceptances row matches active version
 *   3. Tenant selected   — tenantToken present
 *
 * Email verification is intentionally not yet a gate: the schema has no
 * `users.emailVerifiedAt` column, so there is nothing to check. Logged in
 * the Gap Register so this gate can be added once verification ships.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { AUTH_API_URL, checkUnauthorizedAndRedirect } from './auth';

export interface ActiveTermsDoc {
  documentType: 'terms';
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

export interface TermsStatus {
  requiredVersion: string | null;
  acceptedVersion: string | null;
  needsAcceptance: boolean;
  terms: ActiveTermsDoc;
}

export type OnboardingPhase =
  | 'pre-auth'
  | 'pending-terms'
  | 'pending-tenant'
  | 'ready';

export interface OnboardingState {
  phase: OnboardingPhase;
  /** True while the gate is still resolving its initial state. */
  loading: boolean;
  /** Active terms document — populated once webToken is present. */
  terms: ActiveTermsDoc | null;
  /** Accept the active terms version. Resolves once the gate advances. */
  acceptTerms: () => Promise<void>;
  /** Re-fetch terms status (e.g. after admin publishes a new version). */
  refresh: () => Promise<void>;
}

export async function fetchTermsStatus(webToken: string): Promise<TermsStatus> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/legal/terms/status`, {
    headers: { Authorization: `Bearer ${webToken}` },
  });
  checkUnauthorizedAndRedirect(res, true);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to load terms status');
  }
  return (await res.json()) as TermsStatus;
}

export async function acceptActiveTerms(
  webToken: string,
  version: string,
): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/legal/terms/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${webToken}`,
    },
    body: JSON.stringify({ version }),
  });
  checkUnauthorizedAndRedirect(res, true);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to accept terms');
  }
}

/**
 * Drives the post-login gate. Components should not branch on
 * `webToken`/`tenantToken` directly to decide what chrome to render — they
 * should consume `phase` here so all gates evolve together.
 */
export function useOnboardingState(): OnboardingState {
  const { webToken, tenantToken } = useAuth();

  const [terms, setTerms] = useState<ActiveTermsDoc | null>(null);
  const [needsTerms, setNeedsTerms] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(!!webToken);

  const load = useCallback(async () => {
    if (!webToken) {
      setTerms(null);
      setNeedsTerms(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const status = await fetchTermsStatus(webToken);
      setTerms(status.terms);
      setNeedsTerms(status.needsAcceptance);
    } finally {
      setLoading(false);
    }
  }, [webToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const acceptTerms = useCallback(async () => {
    if (!webToken || !terms) throw new Error('Cannot accept terms before loading');
    await acceptActiveTerms(webToken, terms.version);
    setNeedsTerms(false);
  }, [webToken, terms]);

  let phase: OnboardingPhase;
  if (!webToken) {
    phase = 'pre-auth';
  } else if (needsTerms === null || needsTerms === true) {
    phase = 'pending-terms';
  } else if (!tenantToken) {
    phase = 'pending-tenant';
  } else {
    phase = 'ready';
  }

  return {
    phase,
    loading,
    terms,
    acceptTerms,
    refresh: load,
  };
}
