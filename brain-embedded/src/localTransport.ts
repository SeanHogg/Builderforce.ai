/**
 * The transport that points the SHARED streamer at a runtime on the user's own machine,
 * and the non-streaming twin of it — one concern, split out of `localFirstTransport.ts`
 * (which re-exports everything here, so callers keep importing from it).
 *
 * All runtimes speak the OpenAI wire format, which is why the whole adaptation is a URL
 * rewrite plus the endpoint's token. Host-neutral: `fetch` is injected; nothing here
 * touches Node, `vscode` or `chrome`.
 */

import {
  fetchLocal,
  localAuthHeaders,
  localChatCompletionsUrl,
  localRuntime,
  normalizeLocalBaseUrl,
  rewriteToLocalUrl,
  type LocalEndpoint,
  type LocalRuntimeId,
} from '@builderforce/local-inference';
import type { BrainTransport } from './streamChatCompletion';
import { hostOf } from './streamFailureDetail';
import { createCredentialTracker } from './localCredentialState';
import { providerErrorMapper } from './localFirstErrors';

/** The `fetch` a host lends the local path (the global in every host by default). */
export type LocalFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Read at CALL time so a harness that swaps the global is honoured. */
export const globalFetch: LocalFetch = (input, init) => fetch(input, init);

/**
 * The transport that points the shared streamer at a local runtime.
 *
 * `getToken` returns the endpoint's own credential or null. Null is the on-device case
 * and is load-bearing: the streamer omits `Authorization` for a null token, so a
 * signed-out client can still run a local turn.
 *
 * `failFast` is for a local-first attempt. The streamer re-sends a request whose
 * connection never opened for about half a minute (`retryOnConnectFailure` — right for
 * the gateway over a flaky network), but a localhost runtime that refuses the connection
 * is NOT running, and the cloud fallback is waiting. So the refusal is re-thrown as a
 * plain error — deliberately with NO `cause`, because the retry walks the cause chain
 * for a connect-failure code and would find it there.
 *
 * The body is the plain OpenAI one (`wire: 'openai'`): no gateway-only field reaches a
 * runtime. `runtime`, when known, lets the registry's `providerSampling` drop the
 * temperature for a provider that picks it per model (Kimi Code).
 */
export function localTransport(
  endpoint: LocalEndpoint,
  fetchImpl: LocalFetch = globalFetch,
  options: { failFast?: boolean; runtime?: LocalRuntimeId } = {},
): BrainTransport {
  const baseUrl = normalizeLocalBaseUrl(endpoint.baseUrl);
  const runtime = options.runtime ? localRuntime(options.runtime) : undefined;
  const credentials = createCredentialTracker();
  return {
    baseUrl,
    getToken: () => endpoint.token ?? null,
    wire: 'openai',
    ...(runtime?.providerSampling ? { providerSampling: true } : {}),
    // A hosted runtime reached directly (Kimi Code) is named in a silence error; an on-device engine keeps the neutral default.
    ...(runtime && !runtime.onDevice ? { destination: { label: runtime.label, host: hostOf(baseUrl) } } : {}),
    credentialState: (signal) => credentials.stateOf(signal),
    // A hosted runtime backed by the person's OWN account (registry `accountProvider`) that refuses the credential is a
    // PROVIDER sign-in problem; mapped to the generic 401 it would be read as a BuilderForce session error.
    ...(runtime?.accountProvider ? { mapError: providerErrorMapper(runtime.accountProvider, runtime.label) } : {}),
    fetch: async (input, init) => {
      const tracked = credentials.track(endpoint, init.signal ?? undefined);
      try {
        return await fetchLocal(tracked, fetchImpl, rewriteToLocalUrl(input), init);
      } catch (e) {
        if (!options.failFast || init.signal?.aborted) throw e;
        throw new Error(`local_runtime_unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/** The message shape a non-streaming local call puts on the wire — structural, because it
 *  only ever JSON-serializes it (hosts hold differently-typed message arrays). */
export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}

/**
 * A non-streaming completion against a local runtime (a summarizer, a scanner). Returns
 * the assistant text ('' when none) and throws on a non-OK response.
 */
export async function completeLocal(
  endpoint: LocalEndpoint,
  model: string,
  messages: readonly LocalChatMessage[],
  signal?: AbortSignal,
  fetchImpl: LocalFetch = globalFetch,
): Promise<string> {
  const res = await fetchLocal(endpoint, fetchImpl, localChatCompletionsUrl(endpoint.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...localAuthHeaders(endpoint) },
    body: JSON.stringify({ model, messages, stream: false }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const txt = await res.text().catch((e: unknown) => `(body unreadable: ${e instanceof Error ? e.message : String(e)})`);
    throw new Error(`local_complete_failed_${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
}
