/**
 * The credential calls — the only auth requests that may bypass `apiRequest`.
 *
 * Every function here runs before a session exists, or in the same tick one is
 * issued and before the app has adopted it:
 *
 *   POST /api/auth/web/login            → { token, user } | verification step
 *   POST /api/auth/web/register         → verification step
 *   POST /api/auth/web/register/verify  → { token, user }
 *   POST /api/auth/web/register/resend
 *   POST /api/auth/magic-link
 *   GET  /api/auth/my-tenants           (with the token just issued)
 *   POST /api/auth/tenant-token         (the web → tenant token exchange)
 *
 * Routing them through `apiRequest` would run its 401 handling on a failed
 * sign-in and bounce the person off the login page they are standing on, and
 * the token exchange has to send the token it was HANDED — the stored one may
 * not exist yet. That is the reason `scripts/check-api-transport.mjs` exempts
 * this file and nothing else in the auth tree. A call that runs WITH a session
 * belongs in `auth/session` or `auth/members`, on the one transport.
 */

import { LOCALE_HEADER, readLocaleCookie } from '@/i18n/config';
import type { AuthUser, Tenant } from '../types';
import { fetchWithTransportReport } from '../errors/transportFailure';
import {
  AUTH_API_URL,
  checkUnauthorizedAndRedirect,
  getDefaultTenantId,
  persistTenantSession,
} from '../auth';

export interface AuthSession {
  token: string;
  user: AuthUser;
}

/**
 * Result of a login / register attempt. Either the caller is fully authenticated
 * (`needsVerification: false` + a session), or the account's email must be verified
 * first (`needsVerification: true` — flip the UI to the code-entry step for `email`).
 */
export type AuthStepResult =
  | { needsVerification: true; email: string; emailDeliveryFailed?: boolean }
  | ({ needsVerification: false } & AuthSession);

export interface TenantTokenResponse {
  token: string;
}

export async function login(email: string, password: string): Promise<AuthStepResult> {
  const res = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/web/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({})) as {
    token?: string; user?: AuthUser; error?: string; message?: string;
    verificationRequired?: boolean; email?: string; emailDeliveryFailed?: boolean;
  };
  // 403 + verificationRequired: the account exists but its email isn't verified.
  if (body.verificationRequired) {
    return { needsVerification: true, email: body.email ?? email, emailDeliveryFailed: body.emailDeliveryFailed };
  }
  if (!res.ok || !body.token || !body.user) {
    throw new Error(body.error ?? body.message ?? 'Login failed');
  }
  return { needsVerification: false, token: body.token, user: body.user };
}

export async function register(
  email: string,
  password: string,
  name: string | undefined,
  agreeToTerms: boolean,
  accountType?: 'standard' | 'freelancer' | 'sales',
  referralCode?: string,
  ageAttested = false,
): Promise<AuthStepResult> {
  const res = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/web/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name, agreeToTerms, accountType, referralCode, ageAttested }),
  });
  const body = await res.json().catch(() => ({})) as {
    token?: string; user?: AuthUser; error?: string; message?: string;
    verificationRequired?: boolean; email?: string; emailDeliveryFailed?: boolean;
  };
  if (!res.ok) {
    throw new Error(body.error ?? body.message ?? 'Registration failed');
  }
  // Normal path: registration never returns a session — the email must be verified.
  if (body.verificationRequired || !body.token || !body.user) {
    return { needsVerification: true, email: body.email ?? email, emailDeliveryFailed: body.emailDeliveryFailed };
  }
  return { needsVerification: false, token: body.token, user: body.user };
}

/**
 * Exchange the emailed OTP for a session. `trustDevice` extends the session to 30
 * days so the user isn't asked to sign in again on this device for a month.
 * On failure the thrown Error carries a `.reason` code ('invalid' | 'expired' |
 * 'too_many' | 'none') so the UI can show a localized message.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  trustDevice: boolean,
): Promise<AuthSession> {
  const res = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/web/register/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, trustDevice }),
  });
  const body = await res.json().catch(() => ({})) as {
    token?: string; user?: AuthUser; error?: string; reason?: string;
  };
  if (!res.ok || !body.token || !body.user) {
    const err = new Error(body.error ?? 'Verification failed') as Error & { reason?: string };
    err.reason = body.reason;
    throw err;
  }
  return { token: body.token, user: body.user };
}

/** Re-send a verification code. Returns a cooldown (seconds) when throttled. */
export async function resendVerificationCode(email: string): Promise<{ cooldownSeconds?: number }> {
  const res = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/web/register/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({})) as { cooldownSeconds?: number; error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Verification email could not be sent');
  return { cooldownSeconds: body.cooldownSeconds };
}

/** API returns { tenants: [...] }; normalizes to Tenant[]. */
export async function getMyTenants(webToken: string): Promise<Tenant[]> {
  const res = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/my-tenants`, {
    headers: { Authorization: `Bearer ${webToken}` },
  });
  checkUnauthorizedAndRedirect(res, !!webToken);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Failed to fetch tenants');
  }
  const data = await res.json() as { tenants?: Array<{ id?: unknown; name?: string; slug?: string; role?: string }> };
  const arr = Array.isArray(data) ? data : data?.tenants;
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => ({
    id: String(t.id ?? ''),
    name: t.name ?? '',
    slug: t.slug,
    role: t.role,
  }));
}

export async function getTenantToken(
  webToken: string,
  tenantId: string
): Promise<TenantTokenResponse> {
  const res = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/tenant-token`, {
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

/**
 * Fetch the user's tenants, auto-select one if unambiguous (single workspace or default set),
 * persist the tenant session, and return the selected tenant — or null if the user must pick.
 *
 * Call this after any auth event that gives you a fresh webToken (OAuth callback, magic link, etc.).
 */
export async function resolveAndSelectTenant(webToken: string): Promise<Tenant | null> {
  let tenants: Tenant[];
  try {
    tenants = await getMyTenants(webToken);
  } catch {
    return null;
  }

  let target: Tenant | null = null;

  if (tenants.length === 1) {
    target = tenants[0];
  } else if (tenants.length > 1) {
    const defaultId = getDefaultTenantId();
    target = defaultId ? (tenants.find((t) => String(t.id) === defaultId) ?? null) : null;
  }

  if (!target) return null;

  try {
    const res = await getTenantToken(webToken, target.id);
    persistTenantSession(res.token, target);
    return target;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth + magic link
// ---------------------------------------------------------------------------

/**
 * The active-locale header, or nothing when no locale has been pinned yet.
 * `apiClient` stamps this on everything that goes through it; the magic-link
 * request is outside that path, so it builds the same header here.
 */
function localeHeader(): Record<string, string> {
  const locale = readLocaleCookie();
  return locale ? { [LOCALE_HEADER]: locale } : {};
}

/**
 * Returns the OAuth initiate URL for a given provider.
 * Redirect the browser to this URL to start the OAuth flow.
 *
 * The active locale rides as a query parameter because nothing else can carry it.
 * This is a top-level NAVIGATION to a different origin: `apiClient`'s
 * `X-Builderforce-Locale` header does not apply to a navigation, and `NEXT_LOCALE`
 * is set without a domain attribute so it is not sent to `api.builderforce.ai`
 * either. The API signs it into the OAuth state envelope so it survives the hop to
 * the provider and back — without it an OAuth signup could only ever be filed
 * under the OS language, which is the account's locale until the user happens to
 * visit Settings.
 */
export function getOAuthUrl(provider: string, redirect = '/dashboard', linkToken?: string): string {
  const params = new URLSearchParams({ redirect });
  if (linkToken) params.set('link_token', linkToken);
  const locale = readLocaleCookie();
  if (locale) params.set('locale', locale);
  return `${AUTH_API_URL}/api/auth/oauth/${provider}?${params.toString()}`;
}

/**
 * Request a magic link sign-in email.
 * Always returns successfully — does not reveal whether the email exists.
 */
export async function requestMagicLink(email: string, redirect = '/dashboard'): Promise<void> {
  const res = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/magic-link`, {
    method: 'POST',
    // Without the locale header the sign-in email is written in the OS language,
    // not the one the person chose.
    headers: { 'Content-Type': 'application/json', ...localeHeader() },
    body: JSON.stringify({ email, redirect }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? 'Failed to send magic link');
  }
}
