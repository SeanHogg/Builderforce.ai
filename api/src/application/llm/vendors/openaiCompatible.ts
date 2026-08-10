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

import { pseudoStreamFromCall } from './pseudoStream';
import {
  AUTH_STATUSES,
  buildOpenAIChatBody,
  executeChatCompletion,
  executeChatCompletionStream,
  forwardCallOpts,
  VendorRetryableError,
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
export type VendorApiKeyEnv = {
  [K in keyof VendorEnv]-?: Exclude<VendorEnv[K], null | undefined> extends string ? K : never
}[keyof VendorEnv] & string;

export interface OpenAICompatibleVendorOptions {
  /** Registry id (must be a member of {@link VendorId}). */
  id: VendorId;
  /** Full chat-completions URL, e.g. `https://api.groq.com/openai/v1/chat/completions`. */
  baseUrl: string;
  /** A SIBLING REGIONAL HOST for the same vendor, when the provider runs two
   *  independent platforms whose keys are not interchangeable (Moonshot's
   *  international `api.moonshot.ai` vs China `api.moonshot.cn`). Nothing about a
   *  key says which platform issued it, so a single hard-coded host silently 401s
   *  half the world's credentials. When set, an auth rejection from `baseUrl` is
   *  retried ONCE here, and the winning host is remembered for that key — see
   *  {@link resolveRegionalEndpoint}. Leave unset for single-host vendors. */
  altBaseUrl?: string;
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
  /** Omit the streaming surface (a vendor without SSE support). Default: streaming on.
   *  NOTE: a `noStream` vendor is SKIPPED entirely on a streaming dispatch — use
   *  {@link OpenAICompatibleVendorOptions.pseudoStream} instead when the vendor should
   *  still serve streamed requests, just not incrementally. */
  noStream?: boolean;
  /**
   * Serve streaming requests by replaying the completed non-streaming call as a
   * one-shot SSE, via the shared {@link pseudoStreamFromCall} adapter.
   *
   * For a vendor whose transport genuinely cannot stream — Kimi Code runs over the
   * request/response host relay, so an SSE body would arrive whole regardless. The
   * alternative, `noStream`, would make streaming dispatch SKIP the vendor: a caller
   * that streams would silently never reach the account they connected.
   */
  pseudoStream?: boolean;
  /** Per-vendor JSON-Schema strict-mode strip set (see `VendorModule.schemaDialect`). */
  schemaDialect?: { stripKeywords: readonly string[] };
  /** This upstream refuses the Worker's own egress — see `VendorModule.requiresLocalEgress`. */
  requiresLocalEgress?: boolean;
}

/**
 * Which regional host a given credential belongs to, remembered per key.
 *
 * This is deliberately NOT the read-through cache (`getOrSetCached`): that helper
 * caches DATA, which changes and therefore needs cross-isolate invalidation, and it
 * needs a KV binding the vendor layer does not have — `VendorEnv` is a flat bag of
 * secrets by design. What is memoized here is an IMMUTABLE fact about a credential
 * (the platform that issued it never changes for a given key), so a stale entry is
 * impossible and a cold isolate costs exactly one extra 401. Without it, every call
 * on a China-platform key would pay a wasted rejection against the international
 * host first.
 *
 * Keys are stored as a non-reversible 32-bit digest, never the secret itself — this
 * map outlives the request in module scope, and an isolate is shared across tenants.
 * Bounded so a long-lived isolate seeing many tenants cannot grow it without limit.
 */
const regionByKeyDigest = new Map<string, string>();
const REGION_MEMO_MAX_ENTRIES = 512;

/** FNV-1a over the key + vendor id. Not cryptographic and does not need to be: a
 *  collision only picks the wrong host FIRST, which the fallback then corrects. */
function keyDigest(vendorId: string, apiKey: string): string {
  let hash = 0x811c9dc5;
  const input = `${vendorId}:${apiKey}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function rememberRegion(digest: string, endpoint: string): void {
  // Cheap FIFO eviction — order of insertion is Map's own iteration order.
  if (regionByKeyDigest.size >= REGION_MEMO_MAX_ENTRIES) {
    const oldest = regionByKeyDigest.keys().next();
    if (!oldest.done) regionByKeyDigest.delete(oldest.value);
  }
  regionByKeyDigest.set(digest, endpoint);
}

/** True for the rejections that mean "wrong platform for this key" — the upstream
 *  refused the CREDENTIAL, which is exactly the case a sibling host can answer.
 *  A capacity 403 never reaches here: it is normalized to 429 upstream. */
function isAuthRejection(error: unknown): boolean {
  return error instanceof VendorRetryableError && AUTH_STATUSES.has(error.status);
}

/**
 * Run `attempt` against the host this key is known to live on, falling back to the
 * sibling regional host exactly once when the credential is REJECTED (never on a
 * transient failure — re-sending a 429 or a 502 to a different platform would just
 * spend the caller's money to learn nothing).
 *
 * When both hosts reject, the PRIMARY error is what propagates: the operator asked
 * for the default platform, and an error naming the sibling would send them to fix
 * an account they never meant to use.
 */
async function resolveRegionalEndpoint<T>(
  vendorId: string,
  apiKey: string,
  primary: string,
  alt: string | undefined,
  attempt: (endpoint: string) => Promise<T>,
): Promise<T> {
  if (!alt) return attempt(primary);

  const digest = keyDigest(vendorId, apiKey);
  const first = regionByKeyDigest.get(digest) ?? primary;
  const second = first === primary ? alt : primary;

  try {
    const result = await attempt(first);
    rememberRegion(digest, first);
    return result;
  } catch (error) {
    if (!isAuthRejection(error)) throw error;
    try {
      const result = await attempt(second);
      rememberRegion(digest, second);
      return result;
    } catch (fallbackError) {
      // Both platforms refused it. Forget the memo so a key that is later fixed on
      // either side is not pinned to whichever host happened to be tried first.
      regionByKeyDigest.delete(digest);
      // Whichever attempt hit `primary` is the one worth reporting.
      throw first === primary ? error : fallbackError;
    }
  }
}

/**
 * Build a fully-wired OpenAI-compatible {@link VendorModule}. The returned module
 * is registered in `vendors/registry.ts` exactly like a hand-rolled one.
 */
export function createOpenAICompatibleVendor(opts: OpenAICompatibleVendorOptions): VendorModule {
  const {
    id, baseUrl, altBaseUrl, apiKeyEnv, headers,
    catalog = [],
    defaultTier = 'STANDARD',
    maxTokensField,
    transformExtra,
    autoRoute = false,
    noStream = false,
    pseudoStream = false,
    schemaDialect,
    requiresLocalEgress = false,
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
    ...(schemaDialect ? { schemaDialect } : {}),
    ...(requiresLocalEgress ? { requiresLocalEgress } : {}),
    tierFor(modelId: string): AiModelTier {
      return catalogById.get(modelId)?.tier ?? defaultTier;
    },
    apiKeyFrom(env: VendorEnv): string | null {
      return (env[apiKeyEnv] as string | null | undefined) ?? null;
    },
    async call(params: VendorCallParams): Promise<VendorCallResult> {
      return resolveRegionalEndpoint(id, params.apiKey, baseUrl, altBaseUrl, (endpoint) =>
        executeChatCompletion({
          vendorId: id,
          endpoint,
          apiKey: params.apiKey,
          model: params.model,
          body: { ...buildBody(params), stream: false },
          ...(headers ? { headers } : {}),
          ...forwardCallOpts(params),
        }));
    },
  };

  if (pseudoStream) {
    // Still a streaming-capable vendor as far as the cascade is concerned — it just
    // delivers the whole answer in one chunk. Rides the SAME adapter as the Responses
    // vendors, so usage and resolved model survive into the stream.
    mod.callStream = async (params: VendorCallParams): Promise<VendorStreamResult> =>
      pseudoStreamFromCall(await mod.call(params), params);
  } else if (!noStream) {
    mod.callStream = async (params: VendorCallParams): Promise<VendorStreamResult> =>
      resolveRegionalEndpoint(id, params.apiKey, baseUrl, altBaseUrl, (endpoint) =>
        executeChatCompletionStream({
          vendorId: id,
          endpoint,
          apiKey: params.apiKey,
          model: params.model,
          body: buildBody(params),
          ...(headers ? { headers } : {}),
          ...forwardCallOpts(params),
        }));
  }

  return mod;
}
