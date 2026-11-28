import { TENANT_SESSION_REFRESH_MARGIN_SECONDS, TENANT_SESSION_TTL_SECONDS, WORKSPACE_TOKEN_PATH } from './tenantSessionContract.js';

const REFRESH_MARGIN_MS = TENANT_SESSION_REFRESH_MARGIN_SECONDS * 1000;
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

/** In-memory editor tokens. Each host keeps its long-lived credential in its own vault. */
export function createEditorSessionCache(now: () => number) {
  const tokens: { base?: EditorTenantToken; active?: EditorTenantToken } = {};
  return {
    tokens,
    fresh(slot: keyof typeof tokens, tenant?: number): EditorTenantToken | undefined {
      const token = tokens[slot];
      return token && (tenant === undefined || token.tenantId === tenant) && isTenantSessionFresh(token.exp, now())
        ? token : undefined;
    },
    clear(): void {
      delete tokens.base;
      delete tokens.active;
    },
  };
}

/** Concurrent requests for the same session and refresh mode share their network exchange. */
export function createEditorSessionFlights<T>() {
  const requests = new Map<string, Promise<T>>();
  return {
    run(key: string, mint: () => Promise<T>): Promise<T> {
      const running = requests.get(key);
      if (running) return running;
      const request = mint().finally(() => { if (requests.get(key) === request) requests.delete(key); });
      requests.set(key, request);
      return request;
    },
    clear: () => requests.clear(),
  };
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

type WorkspaceTokenResult =
  | { state: 'minted'; jwt: EditorTenantToken }
  | { state: 'forbidden'; error: unknown; baseToken: string }
  | { state: 'unavailable'; baseToken: string };

/** Re-scope an editor session, refreshing a stale base token at most once. */
export async function resolveEditorWorkspaceToken(options: {
  baseUrl: string;
  tenantId: number;
  baseToken: string;
  fetch: SessionFetch;
  now(): number;
  isCurrent(): boolean;
  refreshBase(): Promise<{ token: string } | null | undefined>;
}): Promise<WorkspaceTokenResult | undefined> {
  let baseToken = options.baseToken;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!options.isCurrent()) return undefined;
      const response = await requestWorkspaceToken(options.baseUrl, options.tenantId, baseToken, options.fetch);
      const error = response.status === 403 ? await response.json().catch(() => null) as { code?: unknown } | null : null;
      if (!options.isCurrent()) return undefined;
      const stale = response.status === 401 || error?.code === 'session_stale';
      if (stale && attempt === 0) {
        const fresh = await options.refreshBase();
        if (!fresh) break;
        baseToken = fresh.token;
        continue;
      }
      if (response.status === 403 && !stale) return { state: 'forbidden', error, baseToken };
      if (!response.ok) break;
      const jwt = await readEditorTenantToken(response, options.now, options.tenantId);
      if (jwt && options.isCurrent()) return { state: 'minted', jwt };
      break;
    }
  } catch {
    // Network failures leave the host in charge of parking the workspace.
  }
  return options.isCurrent() ? { state: 'unavailable', baseToken } : undefined;
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
