/**
 * OpenRouter vendor module.
 *
 * Catalog mirrors the historical FREE_MODEL_POOL + PRO_PAID_MODEL_POOL split
 * that LlmProxyService used to manage directly. Free-tier models drive the
 * Free plan; STANDARD/PREMIUM/ULTRA models extend the Pro plan.
 */

import {
  buildOpenAIChatBody,
  executeChatCompletion,
  executeChatCompletionStream,
  forwardCallOpts,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';
import { CEREBRAS_STRICT_KEYWORDS, sanitizeExtraBodyForVendor } from '../jsonSchemaSanitize';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// Embeddings live in their own multi-vendor surface (`../embeddingVendors/`)
// with OpenRouter→Voyage failover — see `openRouterEmbeddingModule`. This chat
// module is chat-completions only.

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  // ── FREE tier — live zero-priced OpenRouter chat endpoints, strongest first.
  // Verified against GET /api/v1/models on 2026-08-11. Free availability is
  // volatile, so keep this list current rather than retaining retired slugs.
  // Free → free supersessions catch CALLER-supplied retired slugs (production 2026-10:
  // `qwen/qwen3-coder:free`, `qwen/qwen3-next-80b-a3b-instruct:free` and
  // `nousresearch/hermes-3-llama-3.1-405b:free` still arrive from older clients and
  // burned a step each). Same tier, so no plan change rides on the rewrite.
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free',    tier: 'FREE', label: 'Nemotron 3 Ultra 550B (Free)',       brand: 'NVIDIA',    supersedes: ['nousresearch/hermes-3-llama-3.1-405b:free'] },
  { id: 'google/gemma-4-26b-a4b-it:free',            tier: 'FREE', label: 'Gemma 4 26B A4B (Free)',             brand: 'Google',    capabilities: ['vision'] },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free',    tier: 'FREE', label: 'Nemotron 3 Super 120B (Free)',       brand: 'NVIDIA',    supersedes: ['qwen/qwen3-next-80b-a3b-instruct:free', 'meta-llama/llama-3.3-70b-instruct:free'] },
  { id: 'poolside/laguna-s-2.1:free',                tier: 'FREE', label: 'Laguna S 2.1 (Free)',                 brand: 'Poolside',  supersedes: ['qwen/qwen3-coder:free'] },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', tier: 'FREE', label: 'Nemotron 3 Nano Omni 30B Reasoning (Free)', brand: 'NVIDIA' },
  { id: 'google/gemma-4-31b-it:free',                tier: 'FREE', label: 'Gemma 4 31B (Free)',                  brand: 'Google',    supersedes: ['qwen/qwen3.8-27b:free', 'google/gemma-3-27b-it:free'] },
  { id: 'poolside/laguna-xs-2.1:free',               tier: 'FREE', label: 'Laguna XS 2.1 (Free)',                brand: 'Poolside'   },
  { id: 'cohere/north-mini-code:free',               tier: 'FREE', label: 'North Mini Code (Free)',              brand: 'Cohere'     },
  { id: 'nvidia/nemotron-3.5-lightning:free',        tier: 'FREE', label: 'Nemotron 3.5 Lightning (Free)',      brand: 'NVIDIA'     },
  // Free slugs retired on 2026-10-04 with no free successor (each still exists PAID,
  // and mapping free → paid is a tier change, so they are dropped, not superseded):
  // `openai/gpt-oss-20b:free`, `nvidia/nemotron-3-nano-30b-a3b:free`,
  // `nvidia/nemotron-nano-12b-v2-vl:free`, `nvidia/nemotron-nano-9b-v2:free`, `z-ai/glm-5.2:free`.
  // 2026-10-10: `qwen/qwen3.8-27b:free` retired (paid `qwen/qwen3.8-27b` remains); free
  // pins are rewritten to Gemma 4 31B (free) above.

  // ── STANDARD tier — paid low-cost models, prefixed in the paid pool so
  //    Pro/Teams tenants land on cheap models before reaching PREMIUM/ULTRA.
  { id: 'meta-llama/llama-3.1-8b-instruct',          tier: 'STANDARD', label: 'Llama 3.1 8B Instruct',    brand: 'Meta'      },
  { id: 'google/gemma-3-12b-it',                     tier: 'STANDARD', label: 'Gemma 3 12B Instruct',     brand: 'Google'    },
  { id: 'ibm-granite/granite-4.2-8b',                tier: 'STANDARD', label: 'Granite 4.2 8B',           brand: 'IBM',       supersedes: ['ibm-granite/granite-4.1-8b'] },
  { id: 'qwen/qwen3.5-9b',                           tier: 'STANDARD', label: 'Qwen 3.5 9B',              brand: 'Qwen'      },
  { id: 'z-ai/glm-4.7',                              tier: 'STANDARD', label: 'GLM 4.7',                  brand: 'Z.AI'      },
  { id: 'openai/gpt-5-nano',                         tier: 'STANDARD', label: 'GPT-5 Nano',               brand: 'OpenAI'    },
  // Cheap, top-ranked agentic coders (verified live; cost ~$0.1-0.3/M).
  { id: 'xiaomi/mimo-v2.5',                          tier: 'STANDARD', label: 'MiMo-V2.5 (Programming #1)', brand: 'Xiaomi'  },
  { id: 'deepseek/deepseek-v4-flash',                tier: 'STANDARD', label: 'DeepSeek V4 Flash',        brand: 'DeepSeek'  },

  // ── STANDARD tier (cont.) — cheap current-gen frontier for routing/short tasks
  { id: 'anthropic/claude-haiku-4.5',                tier: 'STANDARD', label: 'Claude Haiku 4.5',     brand: 'Anthropic' },

  // ── PREMIUM tier — paid coding-grade models
  // Keep the exact live OpenRouter ids — OpenRouter spells versions with a DOT
  // (`claude-sonnet-5.5`) where Anthropic uses a dash, so the dashed spelling a caller
  // copies from Anthropic's docs is listed in `supersedes` as an alias of the same model.
  { id: 'anthropic/claude-sonnet-5.5',               tier: 'PREMIUM', label: 'Claude Sonnet 5.5',     brand: 'Anthropic', capabilities: ['vision'],
    supersedes: ['anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-4-6', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-sonnet-5-5'] },
  { id: 'openai/gpt-4.1',                            tier: 'PREMIUM', label: 'GPT-4.1',               brand: 'OpenAI',    capabilities: ['vision'] },
  { id: 'openai/o4-mini',                            tier: 'PREMIUM', label: 'o4-mini (reasoning)',   brand: 'OpenAI'    },
  { id: 'google/gemini-2.5-pro',                     tier: 'PREMIUM', label: 'Gemini 2.5 Pro',        brand: 'Google',    capabilities: ['vision'] },
  { id: 'qwen/qwen3.7-plus',                         tier: 'PREMIUM', label: 'Qwen3.7 Plus (agentic + vision)', brand: 'Qwen' },
  { id: 'x-ai/grok-4.20',                            tier: 'PREMIUM', label: 'Grok 4.20',             brand: 'xAI'       },
  { id: 'qwen/qwen3.5-397b-a17b',                    tier: 'PREMIUM', label: 'Qwen 3.5 397B (MoE)',   brand: 'Alibaba'   },

  // ── ULTRA, pin-only — recognised (tier, supersession) but never auto-selected: an
  //    Opus-priced model must be asked for, never cascaded onto.
  { id: 'anthropic/claude-opus-5.5',                 tier: 'ULTRA', label: 'Claude Opus 5.5',         brand: 'Anthropic', autoRoute: false, capabilities: ['vision'],
    supersedes: ['anthropic/claude-opus-5', 'anthropic/claude-opus-5-5'] },

  // NOTE: `google/gemini-2.5-flash-lite` is part of the vendor-diverse premium
  // fallback chain (see `PREMIUM_FALLBACK_MODELS` in LlmProxyService) and is
  // deliberately NOT listed in the catalog. Keeping it out of FREE_MODEL_POOL
  // and PRO_PAID_MODEL_POOL guarantees it only runs AFTER every primary
  // candidate has failed — never in the middle of a chain. Tier classification
  // falls through `tierForOpenRouterModel`'s heuristic and resolves to
  // 'STANDARD' for usage logging.
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForOpenRouterModel(modelId: string): AiModelTier {
  const known = CATALOG_BY_ID.get(modelId);
  if (known) return known.tier;
  // Unknown id — heuristic so tier remains classifiable for non-catalog overrides.
  const m = modelId.toLowerCase();
  if (m.includes(':free')) return 'FREE';
  if (m.includes('opus') || m.includes('gpt-o3')) return 'ULTRA';
  if (m.includes('claude') || m.includes('gpt-4') || m.includes('gemini-2.5-pro')) return 'PREMIUM';
  return 'STANDARD';
}

function buildBody(params: VendorCallParams): Record<string, unknown> {
  // Prompt-cache breakpoints are injected by the shared builder (caching ON for every
  // call). OpenRouter-specific tweak: it routes many `:free` ids to Cerebras, whose
  // strict validator rejects draft-07 JSON-Schema keywords Zod's `toJSONSchema()`
  // emits — strip them so the call doesn't bounce with `[cerebras] 400`. See
  // jsonSchemaSanitize.ts.
  return buildOpenAIChatBody(params, {
    transformExtra: (extra) => sanitizeExtraBodyForVendor('openrouter', extra),
  });
}

const HEADERS = { 'HTTP-Referer': 'https://builderforce.ai' };

export const openRouterModule: VendorModule = {
  id: 'openrouter',
  catalog: CATALOG,
  // The strongest agentic coder on the operator's OpenRouter key — the paid coding
  // pool's Claude rung and the first rung of the coding fallback tail.
  flagships: { agentic: 'anthropic/claude-sonnet-5.5', chat: 'anthropic/claude-sonnet-5.5' },
  // OpenRouter routes many `:free` ids to Cerebras as upstream, so it inherits
  // Cerebras's strict-mode strip set (metadata-driven — see jsonSchemaSanitize.ts).
  schemaDialect: { stripKeywords: CEREBRAS_STRICT_KEYWORDS },
  // The same frontier Claude/Gemini models as the direct vendors, so the same budget:
  // a thinking turn must not inherit the free plan's 15s fast-fail (see attemptTimeout.ts).
  attemptTimeoutMs: {
    byModel: {
      'anthropic/claude-opus-5.5': 90_000,
      'anthropic/claude-sonnet-5.5': 90_000,
      'google/gemini-2.5-pro': 90_000,
    },
  },
  tierFor: tierForOpenRouterModel,
  apiKeyFrom(env) { return env.OPENROUTER_API_KEY ?? null; },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    return executeChatCompletion({
      vendorId: 'openrouter',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      headers: HEADERS,
      ...forwardCallOpts(params),
    });
  },
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return executeChatCompletionStream({
      vendorId: 'openrouter',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      headers: HEADERS,
      ...forwardCallOpts(params),
    });
  },
};
