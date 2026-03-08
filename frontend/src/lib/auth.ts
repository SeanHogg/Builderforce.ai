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

export function clearSession(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(WEB_TOKEN_KEY);
  localStorage.removeItem(TENANT_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TENANT_KEY);
  localStorage.removeItem(LAST_PROJECT_KEY);
  localStorage.removeItem(DEFAULT_TENANT_KEY);
  document.cookie = 'bf_web_token=; path=/; Max-Age=0';
  document.cookie = 'bf_tenant_token=; path=/; Max-Age=0';
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

export async function getMyTenants(webToken: string): Promise<Tenant[]> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/my-tenants`, {
    headers: { Authorization: `Bearer ${webToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Failed to fetch tenants');
  }
  return res.json() as Promise<Tenant[]>;
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
    body: JSON.stringify({ tenantId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Failed to get tenant token');
  }
  return res.json() as Promise<TenantTokenResponse>;
}
