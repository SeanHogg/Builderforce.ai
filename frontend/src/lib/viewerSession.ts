'use client';

import { useEffect, useState } from 'react';
import { useOptionalAuth } from './AuthContext';
import { getStoredTenantToken } from './auth';
import { tenantIdFromToken } from './tokenClaims';

/**
 * WHO IS LOOKING AT THIS BOARD — answerable on every surface the canvas renders on,
 * including the ones with no `AuthProvider` above them.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The canvas is not a port of the web canvas, it IS the web canvas: the VS Code
 * extension compiles `components/creation-canvas/**` and its import closure
 * directly (see the webview's `vite.config.ts`). What it does NOT compile is the
 * web app's root layout, so there is no `AuthProvider` over the tree — and
 * `useAuth()` throws when there is none. One canvas component calling it took the
 * whole board down inside the editor with `useAuth must be used within an
 * AuthProvider`, which the panel could only degrade to the chat surface for.
 *
 * ── AND WHY IT IS NOT JUST `useOptionalAuth()` ───────────────────────────────
 * Falling back to "no provider ⇒ signed out" would be wrong, not merely safe: the
 * editor viewer IS signed in — the extension host mints a tenant JWT and hands it
 * over through `setEmbedAuth()`. Treating them as a guest would hide the
 * restricted-by-default object kinds from a paying member. So the fallback reads
 * the same token `auth.ts` already resolves for embedded surfaces, and takes the
 * workspace off its own `tid` claim.
 *
 * ── THE QUESTION IT ANSWERS ──────────────────────────────────────────────────
 * `hasTenant`, not `isAuthenticated`. A board's access control belongs to the
 * WORKSPACE, and a workspace session is exactly what an embedded surface holds;
 * `isAuthenticated` is `!!webToken` — a person-level web session the editor never
 * has and does not need.
 */
export interface ViewerSession {
  /**
   * Has the session been resolved yet? `false` for the server render and the
   * first hydrated frame, where a stored session is unavoidably invisible.
   * Anything that would HIDE something from a member must wait for this.
   */
  ready: boolean;
  /** A workspace session exists — a web one, or one handed over by an embed host. */
  hasTenant: boolean;
  /** The workspace this surface is acting in, for workspace-scoped reads. */
  tenantId: string | null;
}

export function useViewerSession(): ViewerSession {
  const auth = useOptionalAuth();

  // Only consulted when there is no provider. `getStoredTenantToken()` reads
  // localStorage (absent on the server) and the embed override, so like the
  // provider's own rehydrate it has to land after mount rather than during render.
  const [embedded, setEmbedded] = useState<{ ready: boolean; token: string | null }>({ ready: false, token: null });
  useEffect(() => {
    if (auth) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmbedded({ ready: true, token: getStoredTenantToken() });
  }, [auth]);

  if (auth) {
    return { ready: auth.authReady, hasTenant: auth.hasTenant, tenantId: auth.tenant?.id == null ? null : String(auth.tenant.id) };
  }
  return { ready: embedded.ready, hasTenant: !!embedded.token, tenantId: tenantIdFromToken(embedded.token) };
}
