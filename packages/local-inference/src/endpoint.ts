/**
 * URL composition for a local runtime's OpenAI-compatible surface, and the fence that
 * says which URLs a host may proxy to.
 *
 * Every runtime in the registry speaks the OpenAI wire format (`/v1/models`,
 * `/v1/chat/completions`), which is what lets the SHARED brain-embedded streamer drive
 * them unchanged — the whole adaptation is a URL rewrite plus the endpoint's own token.
 */

import { HTTP_LOCAL_RUNTIMES, type LocalEndpoint, type LocalEndpoints, type LocalRuntimeId } from './runtimes.js';

/**
 * Normalize a configured base to the runtime's ROOT, tolerating the two forms a user is
 * likely to paste: the bare origin (`http://127.0.0.1:1919`) and the OpenAI-compatible
 * base most docs show (`http://127.0.0.1:1919/v1`). Both land on the same root, because
 * every path built here appends `/v1` itself. Trailing slashes are stripped.
 *
 * Deliberately mirrors `normalizeOllamaBaseUrl` in the cloud vendor module: a tenant who
 * saved the `.../v1` form there gets the same forgiveness here.
 */
export function normalizeLocalBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/** The OpenAI-compatible chat endpoint for a runtime root. */
export function localChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeLocalBaseUrl(baseUrl)}/v1/chat/completions`;
}

/** The OpenAI-compatible catalog endpoint for a runtime root. */
export function localModelsUrl(baseUrl: string): string {
  return `${normalizeLocalBaseUrl(baseUrl)}/v1/models`;
}

/**
 * The gateway path the shared `streamChatCompletion` builds, and the local path it must
 * become. The streamer hard-codes `POST {baseUrl}/llm/v1/chat/completions` — right for
 * the gateway, wrong for a runtime serving the plain OpenAI route. Rather than fork the
 * streamer (a second client to keep in step forever), a local transport rewrites the one
 * path it will ever be handed. Exported so a host's tests can pin the rewrite against
 * the constant the streamer actually uses.
 */
export const GATEWAY_COMPLETIONS_PATH = '/llm/v1/chat/completions';
export const LOCAL_COMPLETIONS_PATH = '/v1/chat/completions';

/** Rewrite the gateway completions URL onto the runtime's OpenAI route. Any other URL
 *  passes through untouched, so a future streamer call to a different path fails loudly
 *  at the runtime rather than being silently mangled here. */
export function rewriteToLocalUrl(url: string): string {
  return url.endsWith(GATEWAY_COMPLETIONS_PATH)
    ? `${url.slice(0, -GATEWAY_COMPLETIONS_PATH.length)}${LOCAL_COMPLETIONS_PATH}`
    : url;
}

/**
 * One request to a local runtime with the endpoint's CURRENT bearer. An endpoint with a
 * `credential` is asked for its token right before the call, and a 401 gets one retry with
 * a replacement — the token a run was routed with can expire before its last step. Every
 * other endpoint keeps the headers it was given.
 */
export async function fetchLocal(
  endpoint: LocalEndpoint,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const credential = endpoint.credential;
  if (!credential) return fetchImpl(url, init);
  const send = (token: string | null) => fetchImpl(url, { ...init, headers: withBearer(init.headers, token) });
  const token = await credential();
  const res = await send(token);
  if (res.status !== 401 || !token) return res;
  const replacement = await credential(token);
  if (!replacement || replacement === token) return res;
  await res.body?.cancel().catch(() => undefined);
  return send(replacement);
}

/** `headers` with its Authorization replaced by `token` (removed for null). */
function withBearer(headers: HeadersInit | undefined, token: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => { if (key !== 'authorization') out[key] = value; });
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}

/** The Authorization header an endpoint takes, or none — never an empty Bearer. */
export function localAuthHeaders(endpoint: LocalEndpoint): Record<string, string> {
  return endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {};
}

/**
 * The endpoint `url` is the chat route of, or null when no configured runtime serves it.
 *
 * The destination fence for a host-performed fetch on behalf of an untrusted context (a
 * VS Code webview, an extension page): a proxy that forwards whatever URL it is handed
 * is a request forwarder into the user's machine. It returns the ENDPOINT rather than a
 * boolean because "may this be called?" and "with which credential?" must come from one
 * lookup — two lookups can disagree, and either disagreement leaks a credential to the
 * wrong origin or sends none to the right one.
 *
 * Exact match on the chat route only: `/v1/models`, `/api/pull` and any other path on a
 * configured origin are refused. A `page` runtime is never matched — it has no server
 * for a host to proxy to; its route is answered inside the page.
 */
export function matchLocalChatEndpoint(
  endpoints: LocalEndpoints,
  url: string,
): { provider: LocalRuntimeId; endpoint: LocalEndpoint } | null {
  for (const { id: provider } of HTTP_LOCAL_RUNTIMES) {
    const endpoint = endpoints[provider];
    if (endpoint && endpoint.baseUrl.trim().length > 0 && localChatCompletionsUrl(endpoint.baseUrl) === url) {
      return { provider, endpoint };
    }
  }
  return null;
}
