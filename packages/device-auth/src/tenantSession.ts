import { BUILDERFORCE_WEB_ORIGIN } from './platformOrigins.js';
import { TENANT_SESSION_TTL_SECONDS, WORKSPACE_TOKEN_PATH } from './tenantSessionContract.js';

export function derivePlatformWebBase(gateway: string): string {
  try {
    const url = new URL(gateway);
    url.hostname = url.hostname.replace(/^api\./, '');
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch {
    // A malformed gateway setting has no browser origin.
  }
  return BUILDERFORCE_WEB_ORIGIN;
}

const REFRESH_MARGIN_MS = 60_000;
const MINT_TIMEOUT_MS = 10_000;

type SessionFetch = (url: string, init: RequestInit) => Promise<Response>;

/** New clients use the neutral route, with a 404 fallback for older gateways. */
export async function requestWorkspaceToken(baseUrl: string, tenantId: number, token: string, fetch: SessionFetch): Promise<Response> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const signal = AbortSignal.timeout(MINT_TIMEOUT_MS);
  const response = await fetch(`${baseUrl}${WORKSPACE_TOKEN_PATH}`, {
    method: 'POST', headers, signal, body: JSON.stringify({ tenantId }),
  });
  if (response.status !== 404) return response;
  return fetch(`${baseUrl}/api/vscode/tenants/${tenantId}/token`, { method: 'POST', headers, signal });
}

export interface EditorTenantToken {
  token: string;
  exp: number;
  tenantId: number;
  userId?: string;
}

type EditorKeyExchange = { ok: true; jwt: EditorTenantToken } | { ok: false; rejected: boolean };

export async function readEditorTenantToken(
  response: Response,
  now: () => number,
  expectedTenant?: number,
): Promise<EditorTenantToken | null> {
  const body = await response.json().catch(() => null) as { token?: unknown; tenantId?: unknown; userId?: unknown; expiresIn?: unknown } | null;
  const tenantId = body?.tenantId === undefined ? expectedTenant : body.tenantId;
  if (typeof body?.token !== 'string' || !body.token || typeof tenantId !== 'number' || !Number.isSafeInteger(tenantId) || tenantId <= 0) return null;
  if (expectedTenant !== undefined && expectedTenant !== tenantId) return null;
  return {
    token: body.token,
    tenantId,
    exp: tenantSessionExpiresAt(now(), typeof body.expiresIn === 'number' ? body.expiresIn : undefined),
    userId: typeof body.userId === 'string' ? body.userId : undefined,
  };
}

/** Exchange the key for the workspace it was issued in. Only an explicit refusal invalidates the key. */
export async function exchangeEditorKey(
  baseUrl: string,
  apiKey: string,
  fetch: SessionFetch,
  now: () => number,
): Promise<EditorKeyExchange> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/tenant-api-key-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, rejected: res.status === 401 || res.status === 400 };
    const jwt = await readEditorTenantToken(res, now);
    return jwt ? { ok: true, jwt } : { ok: false, rejected: false };
  } catch {
    return { ok: false, rejected: false };
  }
}

export function tenantSessionExpiresAt(now: number, expiresIn?: number): number {
  return now + (expiresIn ?? TENANT_SESSION_TTL_SECONDS) * 1000;
}

export function isTenantSessionFresh(expiresAt: number, now: number): boolean {
  return now < expiresAt - REFRESH_MARGIN_MS;
}

/** Try once with a fresh token after a 401 when the request body can be replayed. */
export async function sendWithTenantSession(
  jwt: (force?: boolean) => Promise<string | null | undefined>,
  send: (token: string) => Promise<Response>,
  canReplay = true,
): Promise<Response | undefined> {
  const token = await jwt();
  if (!token) return undefined;
  const response = await send(token);
  if (response.status !== 401 || !canReplay) return response;

  const refreshedToken = await jwt(true);
  return refreshedToken ? send(refreshedToken) : undefined;
}
