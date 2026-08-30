/**
 * Self-hosted FreeToken vendor module — a TENANT'S OWN FreeToken engine (typically
 * `http://127.0.0.1:1919` on their connected agent host, or a LAN address).
 *
 * FreeToken serves an OpenAI-compatible surface (`POST /v1/chat/completions`, Bearer
 * auth, SSE deltas, `tools`/`tool_calls`), so unlike `ollama` — whose native `/api/chat`
 * speaks NDJSON and needs its own body builder and parser — this module carries NO wire
 * format of its own. It reuses the shared `executeChatCompletion` /
 * `executeChatCompletionStream` transport exactly as the factory-built commercial
 * vendors do, and therefore supports STREAMING (which `ollama`/`ollama-local` cannot).
 *
 * It is nonetheless a small bespoke module rather than a `createOpenAICompatibleVendor`
 * call, for one reason: that factory bakes in ONE fixed vendor host, and a self-hosted
 * engine's address is per-tenant. So the base URL and model ride the shared
 * `<apiKey>::<baseUrl>::<model>` sentinel (`selfHostedSentinel.ts`) that `ollama-local`
 * uses, and the endpoint is composed per call.
 *
 * BYO-only, like `ollama-local`: there is no operator-level connection, and the Worker
 * cannot reach a private/local address on its own — every call rides
 * `requiresLocalEgress`, which routes it through the tenant's connected agent host
 * (`hostEgress.ts`). That relay enforces its own destination fence
 * (`agent-runtime/src/infra/host-egress.ts`): a plain-HTTP request is let through ONLY
 * when its origin matches an origin the HOST ITSELF configured, on exactly the one path
 * that origin is registered for. This module cannot widen that — it can only ask.
 *
 * There is no per-connection model CATALOG: one connection names ONE model, exactly like
 * `ollama-local` and `azure-openai`'s single deployment — so `direct/freetoken/default`
 * always dispatches to whatever model the tenant configured, ignoring the requested
 * catalog id.
 */

import {
  normalizeSelfHostedBaseUrl,
  splitSelfHostedSentinel,
} from './selfHostedSentinel';
import {
  buildOpenAIChatBody,
  executeChatCompletion,
  executeChatCompletionStream,
  forwardCallOpts,
  type VendorCallParams,
  type VendorCallResult,
  type VendorEnv,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'default', label: 'Configured model (self-hosted FreeToken)', brand: 'FreeToken', tier: 'FREE' },
];

/** The OpenAI-compatible chat path FreeToken serves. Kept as a named constant because
 *  the on-prem host's egress fence must allow exactly this path for the tenant's
 *  configured FreeToken origin — the two have to agree byte-for-byte. */
const FREETOKEN_CHAT_PATH = '/v1/chat/completions';

/** Endpoint for one connection's configured base URL. */
function endpointFor(baseUrl: string): string {
  return `${normalizeSelfHostedBaseUrl(baseUrl)}${FREETOKEN_CHAT_PATH}`;
}

/**
 * The shared options every call/stream needs. The configured model is fixed per
 * connection, so the body is built off the CONFIGURED model id, never the requested
 * catalog id (`default`) — mirroring `ollama-local` and `azure-openai`.
 */
function callOptions(params: VendorCallParams) {
  const { apiKey, baseUrl, model } = splitSelfHostedSentinel('freetoken', params.apiKey);
  return {
    vendorId: 'freetoken' as const,
    endpoint: endpointFor(baseUrl),
    apiKey,
    model,
    body: buildOpenAIChatBody({ ...params, model }),
    ...forwardCallOpts(params),
  };
}

export const freetokenModule: VendorModule = {
  id: 'freetoken',
  catalog: CATALOG,
  tierFor: () => 'FREE',
  // A tenant's own runtime is not a reliable cloud backend — reachable ONLY via an
  // explicit `direct/freetoken/default` pin, exactly like `ollama-local`.
  autoRoute: false,
  apiKeyFrom(env: VendorEnv): string | null {
    return env.FREETOKEN_CONFIG ?? null;
  },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const opts = callOptions(params);
    return executeChatCompletion({ ...opts, body: { ...opts.body, stream: false } });
  },
  // Unlike `ollama`/`ollama-local`, the engine speaks SSE on the OpenAI route, so a
  // streamed dispatch is served incrementally rather than skipped or pseudo-streamed.
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return executeChatCompletionStream(callOptions(params));
  },
  requiresLocalEgress: true,
};
