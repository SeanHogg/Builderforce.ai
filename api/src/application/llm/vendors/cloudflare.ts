/**
 * Cloudflare Workers AI vendor module.
 *
 * Calls go through Cloudflare's **OpenAI-compatible** endpoint
 * (`POST /accounts/<id>/ai/v1/chat/completions`) — standard OpenAI request
 * (`{model, messages, tools, …}`) AND standard OpenAI response, so this module
 * reuses the shared `executeChatCompletion` transport like every other
 * OpenAI-shaped vendor. (It previously used the native `/ai/run/<model>` endpoint
 * with a hand-rolled tool translation that flattened `tools` to `{name, …}` — the
 * newer FC models, e.g. `@cf/moonshotai/kimi-k2.7-code`, REJECT that shape with
 * `400: tools[0].function: Field required` because they want the OpenAI-nested
 * `{type:'function', function:{…}}`. The OpenAI-compatible endpoint takes the
 * nested shape verbatim, so the translation — and that whole class of bug — is gone.)
 *
 * Bindings:
 *   CLOUDFLARE_AI_API_TOKEN — `cfut_*` token sent as `Authorization: Bearer`.
 *   CLOUDFLARE_ACCOUNT_ID   — embedded in the URL (`/accounts/<id>/ai/v1/...`).
 *
 * Both must be present for `apiKeyFrom` to return a non-null value; otherwise
 * the dispatcher skips Cloudflare with `skippedNoKey` exactly as it does any
 * other unbound vendor. Tiering is STANDARD by default (cheap, small models);
 * upgrade specific catalog entries to PREMIUM if you onboard a larger model.
 */

import {
  buildOpenAIChatBody,
  executeChatCompletion,
  forwardCallOpts,
  VendorFatalError,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorEnv,
  type VendorModelEntry,
  type VendorModule,
} from './types';

// Paid Workers AI checkpoints joining the PRO paid pool (autoRoutableModelsByTier
// pulls STANDARD/PREMIUM/ULTRA), LED by Cloudflare (PAID_LEAD_VENDOR) so the free
// daily neuron allowance is drained before any metered vendor. Tool-capable entries
// drive the multi-turn coding loop (the OpenAI-compatible endpoint takes OpenAI
// `tools`/`tool_choice` verbatim), so the coders ALSO sit in CODING_MODEL_POOL.
//
// EVERY id + `tools` capability here is verified against the LIVE Cloudflare catalog
// (`wrangler ai models --json` → `function_calling: true`), 2026-06-15 — a stale id
// 404s on every call and silently floors coding overflow onto the metered Anthropic
// key (the bug that drained the $10 cap: the old `@cf/meta/llama-3-8b-instruct` was
// retired). Keep in sync with the live catalog, not from memory.
const CATALOG: ReadonlyArray<VendorModelEntry> = [
  // General utility (function-calling capable, but not curated coders).
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8', tier: 'STANDARD', label: 'Llama 3.1 8B FP8 (Cloudflare)',  brand: 'Meta',   capabilities: ['tools'] },
  { id: '@cf/google/gemma-4-26b-a4b-it',      tier: 'STANDARD', label: 'Gemma 4 26B A4B (Cloudflare)',   brand: 'Google', capabilities: ['tools'] },
  // Agentic coders — tool-capable, drive the multi-turn coding loop on free neurons.
  // `contextWindow` is the LIVE per-model limit (verified via `wrangler ai models`).
  // ALL are kept — the small-window ones are great first-pass picks for small tasks
  // (fast, cheap neurons); the model-selection layer is context-aware (see
  // `pickCloudModel` + SSM learned routing) so a small-window model isn't SEEDED into
  // a context it can't hold (the 97K-into-32K 413 bug), and a 413 still cascades up
  // to a bigger window (see CASCADE_STATUSES) as the safety net.
  { id: '@cf/zai-org/glm-4.7-flash',                tier: 'STANDARD', label: 'GLM 4.7 Flash (Cloudflare)',         brand: 'Z.AI',        contextWindow: 131072, capabilities: ['tools', 'structured_output'] },
  { id: '@cf/moonshotai/kimi-k2.7-code',            tier: 'PREMIUM',  label: 'Kimi K2.7 Code (Cloudflare)',        brand: 'Moonshot AI', contextWindow: 262144, capabilities: ['tools', 'structured_output'] },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8',               tier: 'STANDARD', label: 'Qwen3 30B A3B (Cloudflare)',         brand: 'Qwen',        contextWindow: 32768,  capabilities: ['tools', 'structured_output'] },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', tier: 'STANDARD', label: 'Llama 3.3 70B FP8 Fast (Cloudflare)', brand: 'Meta',        contextWindow: 24000,  capabilities: ['tools', 'structured_output'] },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForCloudflareModel(modelId: string): AiModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'STANDARD';
}

/**
 * Cloudflare's OpenAI-compatible chat-completions endpoint. The account id is in the
 * path; the model id rides in the body like every other OpenAI-shaped vendor.
 */
function endpointFor(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
}

export const cloudflareModule: VendorModule = {
  id: 'cloudflare',
  catalog: CATALOG,
  tierFor: tierForCloudflareModel,
  apiKeyFrom(env: VendorEnv): string | null {
    // Both must be present — the URL needs the account id, the header needs
    // the token. Composing into a single sentinel string keeps the registry's
    // `apiKeyFrom` contract (string | null) unchanged; we split it back inside
    // `call` below. Format: `<token>::<accountId>`.
    const token     = env.CLOUDFLARE_AI_API_TOKEN ?? null;
    const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? null;
    if (!token || !accountId) return null;
    return `${token}::${accountId}`;
  },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const [token, accountId] = params.apiKey.split('::');
    if (!token || !accountId) {
      throw new VendorFatalError('cloudflare', 500, 'malformed cloudflare apiKey sentinel (expected "<token>::<accountId>")');
    }
    // Shared OpenAI transport: standard request + response + 4xx classification
    // (incl. the 413 context-overflow cascade and capacity-limit failover).
    return executeChatCompletion({
      vendorId: 'cloudflare',
      endpoint: endpointFor(accountId),
      apiKey: token,
      model: params.model,
      body: buildOpenAIChatBody(params),
      ...forwardCallOpts(params),
    });
  },
  // No `callStream` — streaming dispatch skips Cloudflare (records `skippedNoStream`);
  // the cloud coding loop is non-streaming, so Cloudflare is reached on the `call` path.
};
