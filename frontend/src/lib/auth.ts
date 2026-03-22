/**
 * Authentication helpers for api.builderforce.ai
 *
 * Endpoints used:
 *   POST /api/auth/web/login         → { token: string; user: AuthUser }
 *   POST /api/auth/web/register      → { token: string; user: AuthUser }
 *   GET  /api/auth/my-tenants        → Tenant[]
 *   POST /api/auth/tenant-token      → { token: string }
 */

import type { AuthUser, Tenant } from './types';

export const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

// ---------------------------------------------------------------------------
// Storage helpers (localStorage)
// ---------------------------------------------------------------------------

const WEB_TOKEN_KEY = 'bf_web_token';
const TENANT_TOKEN_KEY = 'bf_tenant_token';
const USER_KEY = 'bf_user';
const TENANT_KEY = 'bf_tenant';
const LAST_PROJECT_KEY = 'bf_last_project_id';
/** Default tenant for auto-selection when user has multiple workspaces (CoderClawLink-style). */
const DEFAULT_TENANT_KEY = 'bf_default_tenant_id';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getStoredWebToken(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(WEB_TOKEN_KEY);
}

export function getStoredTenantToken(): string | null {
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

export function getStoredTenant(): Tenant | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(TENANT_KEY);
    return raw ? (JSON.parse(raw) as Tenant) : null;
  } catch {
    return null;
  }
}

export function getStoredLastProjectId(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(LAST_PROJECT_KEY);
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

// ---------------------------------------------------------------------------
// Centralized 401 (invalid/expired token) handling — redirect to login
// ---------------------------------------------------------------------------

/**
 * Call when an API response is 401 and we had sent a token.
 * Clears session and redirects to /login?next=currentPath so the user can re-authenticate.
 * Use only in the browser; throws on server.
 */
export function handleApiUnauthorized(): never {
  if (!isBrowser()) {
    throw new Error('Unauthorized');
  }
  clearSession();
  const next = encodeURIComponent(
    window.location.pathname + window.location.search || '/'
  );
  window.location.href = `/login?next=${next}`;
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

// ---------------------------------------------------------------------------
// API calls to api.builderforce.ai
// ---------------------------------------------------------------------------

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface RegisterResponse {
  token: string;
  user: AuthUser;
}

export interface TenantTokenResponse {
  token: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/web/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Login failed');
  }
  return res.json() as Promise<LoginResponse>;
}

export async function register(
  email: string,
  password: string,
  name?: string
): Promise<RegisterResponse> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/web/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Registration failed');
  }
  return res.json() as Promise<RegisterResponse>;
}

/** API returns { tenants: [...] }; normalizes to Tenant[]. */
export async function getMyTenants(webToken: string): Promise<Tenant[]> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/my-tenants`, {
    headers: { Authorization: `Bearer ${webToken}` },
  });
  checkUnauthorizedAndRedirect(res, !!webToken);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Failed to fetch tenants');
  }
  const data = await res.json() as { tenants?: Array<{ id?: unknown; name?: string; slug?: string }> };
  const arr = Array.isArray(data) ? data : data?.tenants;
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => ({
    id: String(t.id ?? ''),
    name: t.name ?? '',
    slug: t.slug,
  }));
}

export async function getTenantToken(
  webToken: string,
  tenantId: string
): Promise<TenantTokenResponse> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/tenant-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${webToken}`,
    },
    body: JSON.stringify({ tenantId: Number(tenantId) }),
  });
  checkUnauthorizedAndRedirect(res, !!webToken);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Failed to get tenant token');
  }
  return res.json() as Promise<TenantTokenResponse>;
}

// ---------------------------------------------------------------------------
// OAuth + magic link helpers
// ---------------------------------------------------------------------------

/**
 * Returns the OAuth initiate URL for a given provider.
 * Redirect the browser to this URL to start the OAuth flow.
 */
export function getOAuthUrl(provider: string, redirect = '/dashboard'): string {
  return `${AUTH_API_URL}/api/auth/oauth/${provider}?redirect=${encodeURIComponent(redirect)}`;
}

/**
 * Request a magic link sign-in email.
 * Always returns successfully — does not reveal whether the email exists.
 */
export async function requestMagicLink(email: string, redirect = '/dashboard'): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Failed to send magic link');
  }
}

/**
 * List OAuth providers linked to the current account.
 */
export async function getLinkedAccounts(
  webToken: string,
): Promise<{ accounts: Array<{ provider: string; email: string | null; displayName: string | null }>; hasPassword: boolean }> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/linked-accounts`, {
    headers: { Authorization: `Bearer ${webToken}` },
  });
  checkUnauthorizedAndRedirect(res, !!webToken);
  if (!res.ok) throw new Error('Failed to load linked accounts');
  return res.json() as ReturnType<typeof getLinkedAccounts>;
}

/**
 * Unlink an OAuth provider from the current account.
 */
export async function unlinkProvider(webToken: string, provider: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/unlink/${provider}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${webToken}` },
  });
  checkUnauthorizedAndRedirect(res, !!webToken);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to unlink provider');
  }
}

/**
 * Add a password to an OAuth-only account.
 */
export async function addPassword(webToken: string, password: string): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/add-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webToken}` },
    body: JSON.stringify({ password }),
  });
  checkUnauthorizedAndRedirect(res, !!webToken);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to add password');
  }
}

/** Create a new workspace (tenant). Requires WebJWT; caller becomes owner. */
export async function createTenant(webToken: string, name: string): Promise<Tenant> {
  const res = await fetch(`${AUTH_API_URL}/api/tenants/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${webToken}`,
    },
    body: JSON.stringify({ name: name.trim() }),
  });
  checkUnauthorizedAndRedirect(res, !!webToken);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(body.message ?? body.error ?? 'Failed to create workspace');
  }
  const data = await res.json() as { id: number; name: string; slug?: string };
  return { id: String(data.id), name: data.name, slug: data.slug };
}
