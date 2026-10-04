// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { autoSelectTenant, rememberWorkspaceChoice } from '@/lib/auth/credentials';
import type { Tenant } from '@/lib/types';

export type WorkspaceSessionState =
  | { status: 'signedOut' }
  | { status: 'loading' }
  | { status: 'ready' }
  /** Several workspaces and none chosen yet: the visitor picks. */
  | { status: 'choose'; workspaces: Tenant[] }
  | { status: 'none' }
  | { status: 'failed' };

/**
 * A session WITH a workspace — what Studio and Spawn both need before they can do
 * anything, since projects, purchases and builds all belong to a workspace. A
 * visitor who signed in with a password (no workspace chosen yet) is put in their
 * only workspace (or their default) automatically, and asked only when they have
 * several and no default. That first pick becomes the default, so it is asked once.
 */
export function useWorkspaceSession(): WorkspaceSessionState & { choose: (tenant: Tenant) => Promise<void> } {
  const { authReady, isAuthenticated, hasTenant, webToken, fetchTenants, selectTenant } = useAuth();
  const [state, setState] = useState<WorkspaceSessionState>({ status: 'loading' });

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
        const target = autoSelectTenant(workspaces);
        if (target) await selectTenant(target);
        else setState(workspaces.length ? { status: 'choose', workspaces } : { status: 'none' });
      })
      .catch(() => { if (!cancelled) setState({ status: 'failed' }); });
    return () => { cancelled = true; };
  }, [authReady, isAuthenticated, hasTenant, fetchTenants, selectTenant]);

  const workspaces = state.status === 'choose' ? state.workspaces : undefined;
  const choose = useCallback(async (tenant: Tenant) => {
    await selectTenant(tenant);
    if (webToken && workspaces) await rememberWorkspaceChoice(webToken, tenant, workspaces);
  }, [selectTenant, webToken, workspaces]);

  return { ...state, choose };
}
