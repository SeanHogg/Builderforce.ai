// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import type { Tenant } from '@/lib/types';

export type StudioWorkspaceState =
  | { status: 'signedOut' }
  | { status: 'loading' }
  | { status: 'ready' }
  /** Several workspaces and none chosen yet: the visitor picks. */
  | { status: 'choose'; workspaces: Tenant[] }
  | { status: 'none' }
  | { status: 'failed' };

/**
 * Studio projects live in a workspace, so a session is not enough on its own: a
 * visitor who signed in with a password (no workspace chosen yet) is put in their
 * only workspace automatically, and asked only when they have several.
 */
export function useStudioWorkspace(): StudioWorkspaceState & { choose: (tenant: Tenant) => Promise<void> } {
  const { authReady, isAuthenticated, hasTenant, fetchTenants, selectTenant } = useAuth();
  const [state, setState] = useState<StudioWorkspaceState>({ status: 'loading' });

  useEffect(() => {
    if (!authReady) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isAuthenticated) { setState({ status: 'signedOut' }); return undefined; }
    if (hasTenant) { setState({ status: 'ready' }); return undefined; }
    let cancelled = false;
    setState({ status: 'loading' });
    fetchTenants()
      .then(async (workspaces) => {
        if (cancelled) return;
        if (workspaces.length === 1) await selectTenant(workspaces[0]!);
        else setState(workspaces.length ? { status: 'choose', workspaces } : { status: 'none' });
      })
      .catch(() => { if (!cancelled) setState({ status: 'failed' }); });
    return () => { cancelled = true; };
  }, [authReady, isAuthenticated, hasTenant, fetchTenants, selectTenant]);

  return { ...state, choose: selectTenant };
}
