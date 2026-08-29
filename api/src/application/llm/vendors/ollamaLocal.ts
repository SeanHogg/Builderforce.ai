/**
 * Self-hosted Ollama vendor module — a TENANT'S OWN Ollama instance (typically
 * `http://127.0.0.1:11434` on their connected agent host, or a LAN address), not
 * the managed Ollama Cloud (`ollama.ts`).
 *
 * BYO-only: there is no operator-level connection, and the Worker cannot reach a
 * private/local address on its own — every call rides `requiresLocalEgress`, which
 * routes it through the tenant's connected agent host (`hostEgress.ts`). That relay
 * enforces its own destination fence (`agent-runtime/src/infra/host-egress.ts`): a
 * plain-HTTP request is let through ONLY when its origin matches the ONE Ollama
 * origin the HOST ITSELF already configured (via `builderforce onboard`), on exactly
 * `/api/chat`. This module cannot widen that — it can only ask, and the host decides.
 *
 * Same two-value sentinel pattern `azureOpenai.ts` and `cloudflare.ts` use for a
 * multi-field credential: `apiKeyFrom` composes `<apiKey>::<baseUrl>::<model>` so the
 * registry's `apiKeyFrom(env): string | null` contract stays a single string, and
 * `call` splits it back apart. `apiKey` is usually empty (self-hosted Ollama has no
 * auth by default) but kept for an instance behind a reverse-proxy token. There is no
 * per-connection model CATALOG — one connection names ONE model, exactly like
 * `azure-openai`'s one configured deployment — so `direct/ollama-local/default`
 * always dispatches to whatever model the tenant configured, ignoring the requested
 * catalog id (mirrors Azure's `splitSentinel` pattern exactly).
 */

import {
  buildOllamaChatBody,
  parseOllamaResponse,
} from './ollama';
import {
  executeChatCompletion,
  forwardCallOpts,
  VendorFatalError,
  type VendorCallParams,
  type VendorCallResult,
  type VendorEnv,
  type VendorModelEntry,
  type VendorModule,
} from './types';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'default', label: 'Configured model (self-hosted Ollama)', brand: 'Ollama', tier: 'FREE' },
];

/**
 * Strip a trailing `/v1` and slash exactly like the on-prem host's own
 * `resolveOllamaApiBase` does — the two MUST agree, because the host's destination
 * fence compares this module's request path byte-for-byte against
 * `OLLAMA_LOCAL_EGRESS_PATH` ('/api/chat'). A tenant who saved the OpenAI-compatible
 * `.../v1` form (the more commonly documented one) must still land on the native
 * `/api/chat` endpoint the host allows.
 */
function normalizeOllamaBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.replace(/\/v1$/i, '');
}

/** Split the `<apiKey>::<baseUrl>::<model>` sentinel back apart. `apiKey` may be
 *  empty (self-hosted Ollama commonly has no auth); `baseUrl` and `model` may not. */
function splitSentinel(raw: string): { apiKey: string; baseUrl: string; model: string } {
  const i = raw.indexOf('::');
  if (i < 0) {
    throw new VendorFatalError('ollama-local', 500, 'malformed ollama-local sentinel (expected "<apiKey>::<baseUrl>::<model>")');
  }
  const apiKey = raw.slice(0, i);
  const rest = raw.slice(i + 2);
  const j = rest.indexOf('::');
  if (j < 0) {
    throw new VendorFatalError('ollama-local', 500, 'malformed ollama-local sentinel (expected "<apiKey>::<baseUrl>::<model>")');
  }
  return { apiKey, baseUrl: rest.slice(0, j), model: rest.slice(j + 2) };
}

export const ollamaLocalModule: VendorModule = {
  id: 'ollama-local',
  catalog: CATALOG,
  tierFor: () => 'FREE',
  // A tenant's own runtime is not a reliable cloud coding backend — reachable ONLY
  // via an explicit `direct/ollama-local/default` pin, exactly like `ollama` (cloud)
  // and `azure-openai`.
  autoRoute: false,
  apiKeyFrom(env: VendorEnv): string | null {
    return env.OLLAMA_LOCAL_CONFIG ?? null;
  },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const { apiKey, baseUrl, model } = splitSentinel(params.apiKey);
    const endpoint = `${normalizeOllamaBaseUrl(baseUrl)}/api/chat`;
    return executeChatCompletion({
      vendorId: 'ollama-local',
      endpoint,
      apiKey,
      model,
      // The configured model is fixed per connection (like Azure's one deployment) —
      // build the body off the CONFIGURED model id, not the requested catalog id.
      body: buildOllamaChatBody({ ...params, model }),
      parseResponse: parseOllamaResponse,
      ...forwardCallOpts(params),
    });
  },
  // No callStream — same native-NDJSON reason as `ollama` (cloud).
  requiresLocalEgress: true,
};
