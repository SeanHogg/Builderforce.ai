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
export type AuthedFetch = <T>(path: string, init?: RequestInit) => Promise<T>;

export function authedFetch(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void | Promise<void>,
): AuthedFetch {
  return async <T>(path: string, init?: RequestInit): Promise<T> => {
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
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Prefer a structured `{ error }` / `{ message }` payload so a server diagnostic
      // (e.g. an agent that couldn't reply) surfaces as a sentence, not raw JSON.
      let msg = body;
      try { const j = JSON.parse(body) as { error?: string; message?: string }; msg = j?.error || j?.message || body; } catch { /* not JSON — use the text */ }
      throw new Error(msg || res.statusText || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };
}
