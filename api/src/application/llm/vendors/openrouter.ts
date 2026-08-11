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
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free',    tier: 'FREE', label: 'Nemotron 3 Ultra 550B (Free)',       brand: 'NVIDIA'     },
  { id: 'google/gemma-4-26b-a4b-it:free',            tier: 'FREE', label: 'Gemma 4 26B A4B (Free)',             brand: 'Google'     },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free',    tier: 'FREE', label: 'Nemotron 3 Super 120B (Free)',       brand: 'NVIDIA'     },
  { id: 'poolside/laguna-s-2.1:free',                tier: 'FREE', label: 'Laguna S 2.1 (Free)',                 brand: 'Poolside'   },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', tier: 'FREE', label: 'Nemotron 3 Nano Omni 30B Reasoning (Free)', brand: 'NVIDIA' },
  { id: 'openai/gpt-oss-20b:free',                   tier: 'FREE', label: 'GPT-OSS 20B (Free)',                  brand: 'OpenAI'     },
  { id: 'google/gemma-4-31b-it:free',                tier: 'FREE', label: 'Gemma 4 31B (Free)',                  brand: 'Google'     },
  { id: 'poolside/laguna-xs-2.1:free',               tier: 'FREE', label: 'Laguna XS 2.1 (Free)',                brand: 'Poolside'   },
  { id: 'cohere/north-mini-code:free',               tier: 'FREE', label: 'North Mini Code (Free)',              brand: 'Cohere'     },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free',       tier: 'FREE', label: 'Nemotron 3 Nano 30B (Free)',         brand: 'NVIDIA'     },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free',       tier: 'FREE', label: 'Nemotron Nano 12B v2 VL (Free)',     brand: 'NVIDIA'     },
  { id: 'nvidia/nemotron-nano-9b-v2:free',           tier: 'FREE', label: 'Nemotron Nano 9B v2 (Free)',         brand: 'NVIDIA'     },
  { id: 'inclusionai/ling-3.0-tiny:free',            tier: 'FREE', label: 'Ling 3.0 Tiny (Free)',                brand: 'InclusionAI' },

  // ── STANDARD tier — paid low-cost models, prefixed in the paid pool so
  //    Pro/Teams tenants land on cheap models before reaching PREMIUM/ULTRA.
  { id: 'meta-llama/llama-3-8b-instruct',            tier: 'STANDARD', label: 'Llama 3 8B Instruct',      brand: 'Meta'      },
  { id: 'google/gemma-3-4b-it',                      tier: 'STANDARD', label: 'Gemma 3 4B Instruct',      brand: 'Google'    },
  { id: 'microsoft/phi-4',                           tier: 'STANDARD', label: 'Phi-4',                    brand: 'Microsoft' },
  { id: 'qwen/qwen3.5-9b',                           tier: 'STANDARD', label: 'Qwen 3.5 9B',              brand: 'Qwen'      },
  { id: 'z-ai/glm-4-32b',                            tier: 'STANDARD', label: 'GLM 4 32B',                brand: 'Z.AI'      },
  { id: 'openai/gpt-5-nano',                         tier: 'STANDARD', label: 'GPT-5 Nano',               brand: 'OpenAI'    },
  // Cheap, top-ranked agentic coders (verified live; cost ~$0.1-0.3/M).
  { id: 'xiaomi/mimo-v2.5',                          tier: 'STANDARD', label: 'MiMo-V2.5 (Programming #1)', brand: 'Xiaomi'  },
  { id: 'deepseek/deepseek-v4-flash',                tier: 'STANDARD', label: 'DeepSeek V4 Flash',        brand: 'DeepSeek'  },

  // ── STANDARD tier (cont.) — cheap current-gen frontier for routing/short tasks
  { id: 'anthropic/claude-haiku-4.5',                tier: 'STANDARD', label: 'Claude Haiku 4.5',     brand: 'Anthropic' },

  // ── PREMIUM tier — paid coding-grade models
  // Claude Sonnet 5 replaces Sonnet 4.6. Keep the exact live OpenRouter id.
  { id: 'anthropic/claude-sonnet-5',                 tier: 'PREMIUM', label: 'Claude Sonnet 5',       brand: 'Anthropic' },
  { id: 'openai/gpt-4.1',                            tier: 'PREMIUM', label: 'GPT-4.1',               brand: 'OpenAI'    },
  { id: 'openai/o4-mini',                            tier: 'PREMIUM', label: 'o4-mini (reasoning)',   brand: 'OpenAI'    },
  { id: 'google/gemini-2.5-pro',                     tier: 'PREMIUM', label: 'Gemini 2.5 Pro',        brand: 'Google'    },
  { id: 'qwen/qwen3.7-plus',                         tier: 'PREMIUM', label: 'Qwen3.7 Plus (agentic + vision)', brand: 'Qwen' },
  { id: 'x-ai/grok-3-mini',                          tier: 'PREMIUM', label: 'Grok 3 Mini',           brand: 'xAI'       },
  { id: 'alibaba/qwen3.5-397b-a17b',                 tier: 'PREMIUM', label: 'Qwen 3.5 397B (MoE)',   brand: 'Alibaba'   },

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
  // OpenRouter routes many `:free` ids to Cerebras as upstream, so it inherits
  // Cerebras's strict-mode strip set (metadata-driven — see jsonSchemaSanitize.ts).
  schemaDialect: { stripKeywords: CEREBRAS_STRICT_KEYWORDS },
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
