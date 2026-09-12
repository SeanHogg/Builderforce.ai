/**
 * The stored session — tokens, the signed-in user, the selected workspace, and
 * the one way back to sign-in.
 *
 * This module makes NO network request. The calls that used to live here were
 * split by the one property that decides how they may travel:
 *
 *   - `auth/credentials` — login, register, email verification, the magic link
 *     and the web→tenant token exchange. They run BEFORE a session exists (or in
 *     the same tick one is issued), so they genuinely cannot use `apiRequest`:
 *     its 401 handling would bounce a failed sign-in off the page reporting it.
 *     They are the only auth code the transport guard exempts.
 *   - `auth/session` (profile, onboarding, linked accounts, workspaces) and
 *     `auth/members` (the workspace roster and invitations) run WITH a session,
 *     so they go through `apiRequest` like everything else and get the emulation
 *     token, the locale header, the typed 402 and the 401 redirect. They used to
 *     sit under the same exemption as login, which is how a superadmin emulating
 *     a tenant was shown their OWN members.
 */

import type { AuthUser, Tenant } from './types';
import { API_ORIGIN } from './apiOrigin';

export const AUTH_API_URL = API_ORIGIN;

// ---------------------------------------------------------------------------
// Storage helpers (localStorage)
// ---------------------------------------------------------------------------

const WEB_TOKEN_KEY = 'bf_web_token';
const TENANT_TOKEN_KEY = 'bf_tenant_token';
const USER_KEY = 'bf_user';
const TENANT_KEY = 'bf_tenant';
const LAST_PROJECT_KEY = 'bf_last_project_id';
/** Default tenant for auto-selection when user has multiple workspaces (BuilderForceAgentsLink-style). */
const DEFAULT_TENANT_KEY = 'bf_default_tenant_id';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getStoredWebToken(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(WEB_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Embed-mode auth bridge
//
// When BuilderForce runs inside an <BuilderForceEmbed> iframe, the tenant JWT is
// handed over by the host via postMessage (never localStorage). useEmbedFrame
// calls setEmbedAuth(token); the rest of the auth path is unchanged because
// getStoredTenantToken() + handleApiUnauthorized() consult this override here —
// one place, so embedded and standalone modes share a single auth flow.
// ---------------------------------------------------------------------------

let embedTenantToken: string | null = null;

/** Set/clear the embed-handed tenant token. Passing null exits embed mode. */
export function setEmbedAuth(token: string | null): void {
  embedTenantToken = token;
}

export function isEmbedMode(): boolean {
  return embedTenantToken !== null;
}

export function getStoredTenantToken(): string | null {
  if (embedTenantToken) return embedTenantToken;
  if (!isBrowser()) return null;
  return localStorage.getItem(TENANT_TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

/**
 * Patch the stored user in place.
 *
 * The persisted copy is what the top bar, the sidebar and the footer roster
 * read, so a write that changes an identity field has to land here too or the
 * shell keeps showing the old value until the next sign-in. One helper rather
 * than a `localStorage.setItem(USER_KEY, …)` at each writer — the key is private
 * to this module for exactly that reason.
 */
export function patchStoredUser(patch: Partial<AuthUser>): AuthUser | null {
  if (!isBrowser()) return null;
  const current = getStoredUser();
  if (!current) return null;
  const next = { ...current, ...patch };
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — the server copy is authoritative and the next
    // /api/auth/me read restores it.
  }
  return next;
}

export function getStoredTenant(): Tenant | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(TENANT_KEY);
    return raw ? (JSON.parse(raw) as Tenant) : null;
  } catch {
    return null;
  }
}

export function persistLastProjectId(projectId: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(LAST_PROJECT_KEY, projectId);
}

export function getDefaultTenantId(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(DEFAULT_TENANT_KEY);
}

export function setDefaultTenantId(id: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(DEFAULT_TENANT_KEY, id);
}

export function clearDefaultTenantId(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(DEFAULT_TENANT_KEY);
}

export function persistSession(
  webToken: string,
  user: AuthUser,
  tenantToken?: string,
  tenant?: Tenant
): void {
  if (!isBrowser()) return;
  const secure = window.location?.protocol === 'https:' ? '; Secure' : '';
  localStorage.setItem(WEB_TOKEN_KEY, webToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  document.cookie = `bf_web_token=${webToken}; path=/; SameSite=Lax${secure}`;
  if (tenantToken) {
    localStorage.setItem(TENANT_TOKEN_KEY, tenantToken);
    document.cookie = `bf_tenant_token=${tenantToken}; path=/; SameSite=Lax${secure}`;
  }
  if (tenant) localStorage.setItem(TENANT_KEY, JSON.stringify(tenant));
}

export function persistTenantSession(tenantToken: string, tenant: Tenant): void {
  if (!isBrowser()) return;
  const secure = window.location?.protocol === 'https:' ? '; Secure' : '';
  localStorage.setItem(TENANT_TOKEN_KEY, tenantToken);
  localStorage.setItem(TENANT_KEY, JSON.stringify(tenant));
  document.cookie = `bf_tenant_token=${tenantToken}; path=/; SameSite=Lax${secure}`;
}

/** Past date for cookie expiry so the browser removes the cookie. */
const COOKIE_EXPIRE = 'Thu, 01 Jan 1970 00:00:00 GMT';

export function clearSession(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(WEB_TOKEN_KEY);
  localStorage.removeItem(TENANT_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TENANT_KEY);
  localStorage.removeItem(LAST_PROJECT_KEY);
  localStorage.removeItem(DEFAULT_TENANT_KEY);
  // Clear cookies (path and expires required for reliable removal)
  document.cookie = `bf_web_token=; path=/; expires=${COOKIE_EXPIRE}; Max-Age=0`;
  document.cookie = `bf_tenant_token=; path=/; expires=${COOKIE_EXPIRE}; Max-Age=0`;
}

/**
 * THE way back in — `/login` carrying where the person was going.
 *
 * Fifteen call sites hand-built this string, and the hand-built ones disagreed:
 * some encoded `next`, some did not, and an un-encoded path with a query string
 * (`/create/x?share=1`) lost everything after the `&` on the round trip. One
 * spelling, encoded once, so a sign-in never silently drops the destination.
 */
export function signInHref(next?: string): string {
  const target = next ?? (isBrowser() ? window.location.pathname + window.location.search : '');
  return target ? `/login?next=${encodeURIComponent(target)}` : '/login';
}

/**
 * THE way IN — `/register` carrying where the person was standing.
 *
 * The sibling of `signInHref`, and here for the same reason: a guest is offered an
 * account from more than one surface (the header CTA once this browser holds a local
 * board, the canvas account gate, the guest wall), and every one of them has to bring
 * the visitor back to the work they were doing. Hand-built `/register?next=…` strings
 * disagreed about encoding exactly the way the login ones did.
 *
 * Claiming a local board does NOT depend on this — `claimPendingDrafts` works off the
 * local-draft index precisely so a dropped `next` is never data loss — but landing back
 * on the board you were keeping is the difference between "kept" and "kept somewhere".
 */
export function registerHref(next?: string): string {
  const target = next ?? (isBrowser() ? window.location.pathname + window.location.search : '');
  return target ? `/register?next=${encodeURIComponent(target)}` : '/register';
}

// ---------------------------------------------------------------------------
// Centralized 401 (invalid/expired token) handling — redirect to login
// ---------------------------------------------------------------------------

/**
 * Call when an API response is 401 and we had sent a token.
 * Clears session and redirects to /login?next=currentPath so the user can re-authenticate.
 * Use only in the browser; throws on server.
 */
export function handleApiUnauthorized(): never {
  // In an embed iframe we can't redirect to /login (cross-origin). Drop the
  // stale token and ask the host to re-auth; the embed page surfaces this.
  if (embedTenantToken !== null) {
    embedTenantToken = null;
    if (isBrowser()) window.dispatchEvent(new CustomEvent('bfembed:unauthorized'));
    throw new Error('Embed session expired');
  }
  if (!isBrowser()) {
    throw new Error('Unauthorized');
  }
  clearSession();
  window.location.href = signInHref();
  throw new Error('Session expired');
}

/**
 * If response is 401 and we had sent a bearer token, clear session and redirect to login.
 * Call this after any authenticated fetch so all API paths behave the same.
 */
export function checkUnauthorizedAndRedirect(
  response: Response,
  hadToken: boolean
): void {
  if (response.status === 401 && hadToken) {
    handleApiUnauthorized();
  }
}
