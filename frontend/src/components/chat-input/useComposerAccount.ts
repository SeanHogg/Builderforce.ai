// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import type { BrainComposerProps, JsonRequest, UpgradeTarget } from '@seanhogg/builderforce-brain-ui';
import { apiRequest } from '@/lib/apiClient';
import { useOptionalAuth } from '@/lib/AuthContext';
import { webConnections } from '@/lib/providerConnections';

const request: JsonRequest = (path) => apiRequest(path);

/**
 * The shared Status tab's port on the web: the app's authenticated request, the
 * reader's locale, and where "Upgrade" / "Manage plan" go.
 *
 * Built only for a signed-in workspace session — the snapshot it reads
 * (`/api/consumption`) is the tenant's — and never where the host says this surface
 * has no account behind it (`enabled: false`, a guest panel).
 */
export function useComposerAccount({ enabled, projectId }: {
  enabled: boolean;
  projectId: number | null;
}): BrainComposerProps['account'] {
  const auth = useOptionalAuth();
  const locale = useLocale();
  const router = useRouter();
  const signedIn = !!auth?.isAuthenticated && !!auth.hasTenant;
  return useMemo(() => (enabled && signedIn
    ? {
        request,
        projectId,
        locale,
        // A free tier is sent to pick a paid plan; a paid tier to the same page, where
        // its own plan is the one it manages.
        onUpgrade: (target: UpgradeTarget) => router.push(target === 'pricing' ? '/pricing?upgrade=pro' : '/pricing'),
        // The Status tab's Connected accounts (Test / Reconnect).
        connections: webConnections,
      }
    : undefined), [enabled, signedIn, projectId, locale, router]);
}
