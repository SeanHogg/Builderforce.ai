/**
 * Shared factory for OpenAI-compatible vendor modules.
 *
 * The overwhelming majority of commercial LLM providers expose a standard
 * OpenAI `/chat/completions` endpoint (POST, `Authorization: Bearer <key>`,
 * `{ model, messages, ... }` body, OpenAI response shape). Rather than hand-roll
 * a near-duplicate ~75-line module per provider, every such vendor is built from
 * this one factory — it returns a fully-wired {@link VendorModule} that plugs
 * into the SAME registry-driven dispatch / cooldown / fallback machinery as the
 * bespoke modules (anthropic / cloudflare / googleai keep their own wire format).
 *
 * Each factory-built vendor:
 *   - reads its key from a typed `VendorEnv` field (`apiKeyEnv`),
 *   - routes through `executeChatCompletion` / `executeChatCompletionStream`,
 *   - is reachable via an explicit `<vendor>/<model-id>` pin (registry prefix),
 *   - defaults to `autoRoute: false` so it never silently enters the auto-selected
 *     FREE/PRO pools (the curated free/paid pools stay exactly as tuned) — a
 *     caller opts in per-call by pinning the vendor-prefixed id.
 */

import {
  buildOpenAIChatBody,
  executeChatCompletion,
  executeChatCompletionStream,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorEnv,
  type VendorId,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';

/** The subset of {@link VendorEnv} keys that are simple `string | null` API-key
 *  fields — the only thing the OpenAI-compatible factory needs to read. Every
 *  member of `VendorEnv` is a `string | null` key, so this is just its keyset
 *  (kept as a named alias for intent at call sites). */
export type VendorApiKeyEnv = keyof VendorEnv & string;

export interface OpenAICompatibleVendorOptions {
  /** Registry id (must be a member of {@link VendorId}). */
  id: VendorId;
  /** Full chat-completions URL, e.g. `https://api.groq.com/openai/v1/chat/completions`. */
  baseUrl: string;
  /** Typed `VendorEnv` field holding the Bearer key. */
  apiKeyEnv: VendorApiKeyEnv;
  /** Curated catalog. Most factory vendors carry a small static default set of
   *  real, current model ids — enough that an explicit `<vendor>/<id>` pin, the
   *  admin health probe, and tier classification all work. Callers may also pin
   *  any model id the provider hosts (not just catalog members) via the prefix. */
  catalog?: ReadonlyArray<VendorModelEntry>;
  /** Default tier for non-catalog model ids on this vendor. Default `STANDARD`. */
  defaultTier?: AiModelTier;
  /** Extra static headers (rare — e.g. an HTTP-Referer attribution header). */
  headers?: Record<string, string>;
  /** Output-token field name when the provider deviates from `max_tokens`. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** Transform the passthrough `extraBody` — e.g. strip draft-07 JSON-Schema
   *  keywords a strict vendor validator (Cerebras) rejects. */
  transformExtra?: (extraBody: Record<string, unknown> | undefined) => Record<string, unknown> | undefined;
  /** Whether this vendor may be auto-selected into FREE/PRO pools. Default `false`
   *  — factory vendors are explicit-pin-only so they don't disturb the tuned
   *  curated pools. Pass `true` only for a vendor intended for the auto rotation. */
  autoRoute?: boolean;
  /** Omit the streaming surface (a vendor without SSE support). Default: streaming on. */
  noStream?: boolean;
}

/**
 * Build a fully-wired OpenAI-compatible {@link VendorModule}. The returned module
 * is registered in `vendors/registry.ts` exactly like a hand-rolled one.
 */
export function createOpenAICompatibleVendor(opts: OpenAICompatibleVendorOptions): VendorModule {
  const {
    id, baseUrl, apiKeyEnv, headers,
    catalog = [],
    defaultTier = 'STANDARD',
    maxTokensField,
    transformExtra,
    autoRoute = false,
    noStream = false,
  } = opts;

  const catalogById = new Map(catalog.map((m) => [m.id, m]));
  const bodyOpts = (maxTokensField || transformExtra)
    ? {
        ...(maxTokensField ? { maxTokensField } : {}),
        ...(transformExtra ? { transformExtra } : {}),
      }
    : undefined;
  const buildBody = (params: VendorCallParams): Record<string, unknown> =>
    buildOpenAIChatBody(params, bodyOpts);

  const mod: VendorModule = {
    id,
    catalog,
    autoRoute,
    tierFor(modelId: string): AiModelTier {
      return catalogById.get(modelId)?.tier ?? defaultTier;
    },
    apiKeyFrom(env: VendorEnv): string | null {
      return (env[apiKeyEnv] as string | null | undefined) ?? null;
    },
    async call(params: VendorCallParams): Promise<VendorCallResult> {
      return executeChatCompletion({
        vendorId: id,
        endpoint: baseUrl,
        apiKey: params.apiKey,
        model: params.model,
        body: { ...buildBody(params), stream: false },
        ...(headers ? { headers } : {}),
        ...(params.title ? { title: params.title } : {}),
        ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
      });
    },
  };

  if (!noStream) {
    mod.callStream = async (params: VendorCallParams): Promise<VendorStreamResult> =>
      executeChatCompletionStream({
        vendorId: id,
        endpoint: baseUrl,
        apiKey: params.apiKey,
        model: params.model,
        body: buildBody(params),
        ...(headers ? { headers } : {}),
        ...(params.title ? { title: params.title } : {}),
        ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
      });
  }

  return mod;
}
