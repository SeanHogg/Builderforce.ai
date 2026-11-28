export const TENANT_SESSION_TTL_SECONDS = 3600;
export const WORKSPACE_TOKEN_ROUTE = '/workspace-token';
export const WORKSPACE_TOKEN_PATH = `/api/auth${WORKSPACE_TOKEN_ROUTE}`;

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
    const body = await res.json() as { token?: unknown; tenantId?: unknown; userId?: unknown; expiresIn?: unknown };
    if (typeof body?.token !== 'string' || !body.token || typeof body.tenantId !== 'number') {
      return { ok: false, rejected: false };
    }
    return {
      ok: true,
      jwt: {
        token: body.token,
        tenantId: body.tenantId,
        exp: tenantSessionExpiresAt(now(), typeof body.expiresIn === 'number' ? body.expiresIn : undefined),
        userId: typeof body.userId === 'string' ? body.userId : undefined,
      },
    };
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
