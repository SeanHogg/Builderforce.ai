/**
 * The shared bearer-fetch used by every VS Code webview API client. Attaches the
 * host-minted tenant token, and on a 401 invokes `onUnauthorized`:
 *   - when it returns a promise (the screens pass `refreshToken`) the request is
 *     retried once with the re-minted token, then thrown if it still fails;
 *   - when it returns `void` (the adapters' fire-and-forget `() => void
 *     refreshToken()`) the request is NOT retried — it throws on the 401.
 * Throws on any non-2xx (body → statusText → `HTTP <status>`) and parses JSON
 * (204 ⇒ `undefined`) — the SAME `/api/*` contract the web app's clients use.
 */
import { BrainRequestError, brainRequestError } from '@seanhogg/builderforce-brain-embedded';
import type { GatewayRequest } from '@builderforce/provider-connect';

export type AuthedFetch = <T>(path: string, init?: RequestInit) => Promise<T>;

/**
 * One bearer call with the 401 contract above — the part `authedFetch` and
 * {@link authedGateway} share, so a token refresh behaves the same for both.
 */
function authedSend(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void | Promise<void>,
): (path: string, init?: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const send = () => {
      const token = getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((init?.headers as Record<string, string>) ?? {}),
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(`${baseUrl}${path}`, { ...init, headers });
    };
    let res = await send();
    if (res.status === 401) {
      const maybe = onUnauthorized();
      // A promise-returning refresher (the screens' `refreshToken`) opts into a single
      // retry with the freshly-minted token; a fire-and-forget one returns undefined,
      // matching the adapters' throw-on-401 path.
      if (maybe && typeof (maybe as { then?: unknown }).then === 'function') {
        await maybe;
        res = await send();
      }
    }
    return res;
  };
}

export function authedFetch(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void | Promise<void>,
): AuthedFetch {
  const call = authedSend(baseUrl, getToken, onUnauthorized);
  return async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await call(path, init);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Prefer a structured `{ error }` / `{ message }` payload so a server diagnostic
      // (e.g. an agent that couldn't reply) surfaces as a sentence, not raw JSON — and
      // keep the entitlement fields a plan gate sends (`code`/`unlock`/`requiredPlan`)
      // so the caller can offer Upgrade / Add-a-card. Same error primitive the chat
      // stream uses, so both paths classify through `chatErrorAction`.
      try {
        throw brainRequestError(res.status, JSON.parse(body), res.statusText);
      } catch (e) {
        if (e instanceof BrainRequestError) throw e;
        // Not JSON — fall back to the raw text.
        throw new Error(body || res.statusText || `HTTP ${res.status}`);
      }
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };
}

/**
 * The same bearer call in the shape `@builderforce/provider-connect` takes: the status
 * rides with the body instead of a non-2xx throwing, because the connect flow decides on
 * WHICH refusal it got. Throws only when there was no answer at all (offline).
 */
export function authedGateway(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void | Promise<void>,
): GatewayRequest {
  const call = authedSend(baseUrl, getToken, onUnauthorized);
  return async (path, init) => {
    const res = await call(path, {
      method: init?.method ?? 'GET',
      ...(init?.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    const text = await res.text().catch(() => '');
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    return { status: res.status, body };
  };
}
