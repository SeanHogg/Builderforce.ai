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
  // ── FREE tier — drive builderforceLLM (free plan) and prefix the Pro fallback chain
  { id: 'google/gemma-4-31b-it:free',                tier: 'FREE', label: 'Gemma 4 31B (Free)',                 brand: 'Google'    },
  { id: 'google/gemma-4-26b-a4b-it:free',            tier: 'FREE', label: 'Gemma 4 26B (Free)',                 brand: 'Google'    },
  { id: 'openrouter/elephant-alpha',                 tier: 'FREE', label: 'OpenRouter Elephant Alpha (Free)',   brand: 'OpenRouter' },
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free', tier: 'FREE', label: 'Hermes 3 (Llama 405B, Free)',        brand: 'NousResearch' },
  { id: 'openai/gpt-oss-120b:free',                  tier: 'FREE', label: 'GPT-OSS 120B (Free)',                brand: 'OpenAI'    },
  { id: 'meta-llama/llama-3.3-70b-instruct:free',    tier: 'FREE', label: 'Llama 3.3 70B (Free)',               brand: 'Meta'      },
  { id: 'meta-llama/llama-3.2-3b-instruct:free',     tier: 'FREE', label: 'Llama 3.2 3B (Free)',                brand: 'Meta'      },
  { id: 'z-ai/glm-4.5-air:free',                     tier: 'FREE', label: 'GLM 4.5 Air (Free)',                 brand: 'Z.AI'      },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free',     tier: 'FREE', label: 'Qwen 3 Next 80B (Free)',             brand: 'Qwen'      },
  { id: 'nvidia/nemotron-nano-9b-v2:free',           tier: 'FREE', label: 'Nemotron Nano 9B (Free)',            brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free',       tier: 'FREE', label: 'Nemotron Nano 12B v2 VL (Free)',     brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free',       tier: 'FREE', label: 'Nemotron 3 Nano 30B (Free)',         brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', tier: 'FREE', label: 'Nemotron 3 Nano Omni 30B Reasoning (Free)', brand: 'NVIDIA' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free',    tier: 'FREE', label: 'Nemotron 3 Super 120B (Free)',       brand: 'NVIDIA'    },
  { id: 'qwen/qwen3-coder:free',                     tier: 'FREE', label: 'Qwen 3 Coder (Free)',                brand: 'Qwen'      },
  { id: 'inclusionai/ring-2.6-1t:free',              tier: 'FREE', label: 'Ring 2.6 1T (Free)',                 brand: 'InclusionAI' },
  { id: 'baidu/cobuddy:free',                        tier: 'FREE', label: 'CoBuddy (Free)',                     brand: 'Baidu'     },
  { id: 'baidu/qianfan-ocr-fast:free',               tier: 'FREE', label: 'Qianfan OCR Fast (Free)',            brand: 'Baidu'     },
  { id: 'poolside/laguna-xs.2:free',                 tier: 'FREE', label: 'Laguna XS.2 (Free)',                 brand: 'Poolside'  },
  { id: 'poolside/laguna-m.1:free',                  tier: 'FREE', label: 'Laguna M.1 (Free)',                  brand: 'Poolside'  },
  { id: 'minimax/minimax-m2.5:free',                 tier: 'FREE', label: 'MiniMax M2.5 (Free)',                brand: 'MiniMax'   },
  { id: 'liquid/lfm-2.5-1.2b-thinking:free',         tier: 'FREE', label: 'LFM 2.5 1.2B Thinking (Free)',       brand: 'Liquid'    },
  { id: 'liquid/lfm-2.5-1.2b-instruct:free',         tier: 'FREE', label: 'LFM 2.5 1.2B Instruct (Free)',       brand: 'Liquid'    },
  { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', tier: 'FREE', label: 'Dolphin Mistral 24B Venice (Free)', brand: 'CognitiveComputations' },
  { id: 'openrouter/owl-alpha',                      tier: 'FREE', label: 'OpenRouter Owl Alpha (Free)',          brand: 'OpenRouter' },
  { id: 'arcee-ai/trinity-large-thinking:free',      tier: 'FREE', label: 'Arcee Trinity Large Thinking (Free)',  brand: 'Arcee'     },
  { id: 'openai/gpt-oss-20b:free',                   tier: 'FREE', label: 'GPT-OSS 20B (Free)',                   brand: 'OpenAI'    },
  // Strong FREE agentic coders (verified live on OpenRouter /models, tool-capable).
  { id: 'nex-agi/nex-n2-pro:free',                   tier: 'FREE', label: 'Nex-N2-Pro (Free · agentic)',         brand: 'Nex AGI'   },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free',    tier: 'FREE', label: 'Nemotron 3 Ultra 550B (Free)',        brand: 'NVIDIA'    },

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
  // Claude Sonnet 4.6 replaces the retired Claude 3.7 Sonnet (`claude-3-7-sonnet`
  // was retired on the first-party API 2026-02-19; current-gen Sonnet is 4.6).
  { id: 'anthropic/claude-sonnet-4.6',               tier: 'PREMIUM', label: 'Claude Sonnet 4.6',     brand: 'Anthropic' },
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
